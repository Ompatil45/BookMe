import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { Prisma } from "../prisma/generated/index.js";
import {
  hashPassword, comparePassword, createSession, rotateRefreshSession,
  revokeRefreshSession, clearRefreshCookie, requireAuth,
} from "../dist/auth.js";

// Set after importing auth to exercise index.ts's dotenv initialization order.
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.CLIENT_ORIGIN = "http://localhost:5173";
process.env.NODE_ENV = "test";
const user = { id: "owner", tenantId: "tenant" };
const digest = (raw) => createHmac("sha256", process.env.JWT_REFRESH_SECRET)
  .update(raw).digest("hex");

function response() {
  return {
    cookies: [], cleared: [], statusCode: 200,
    cookie(name, value, options) { this.cookies.push({ name, value, options }); },
    clearCookie(name, options) { this.cleared.push({ name, options }); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// An isolated store exercises helper decisions, not PostgreSQL isolation itself.
function database() {
  const rows = [];
  let sequence = 0;
  const refreshToken = {
    async create({ data }) {
      const row = { id: String(++sequence), revokedAt: null,
        replacedById: null, ...data, user };
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      return rows.find((row) => row.tokenHash === where.tokenHash) ?? null;
    },
    async update({ where, data }) {
      return Object.assign(rows.find((row) => row.id === where.id), data);
    },
    async updateMany({ where, data }) {
      const matches = rows.filter((row) => Object.entries(where)
        .every(([key, value]) => row[key] === value));
      matches.forEach((row) => Object.assign(row, data));
      return { count: matches.length };
    },
  };
  return {
    rows, refreshToken,
    async $transaction(callback, options) {
      assert.equal(options.isolationLevel, "Serializable");
      const snapshot = structuredClone(rows);
      try { return await callback({ refreshToken }); }
      catch (error) { rows.splice(0, rows.length, ...snapshot); throw error; }
    },
  };
}

function authenticate(token) {
  const req = { get: () => token };
  const res = response();
  let nextCalls = 0;
  requireAuth(req, res, () => nextCalls++);
  return { req, res, nextCalls };
}

test("bcrypt hashes are salted and verify only the matching password", async () => {
  const first = await hashPassword("correct-password");
  const second = await hashPassword("correct-password");
  assert.notEqual(first, second);
  assert.equal(await comparePassword("correct-password", first), true);
  assert.equal(await comparePassword("wrong-password", first), false);
});

test("session stores only a hash and issues the expected cookie and JWT", async () => {
  const db = database();
  const res = response();
  const { accessToken } = await createSession(res, user, db);
  const cookie = res.cookies[0];
  assert.equal(cookie.name, "refreshToken");
  assert.match(cookie.value, /^[a-f0-9]{64}$/);
  assert.equal(db.rows[0].tokenHash, digest(cookie.value));
  assert.notEqual(db.rows[0].tokenHash, cookie.value);
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, "lax");
  assert.equal(cookie.options.path, "/api/auth");
  assert.equal(cookie.options.secure, false);
  assert.equal(cookie.options.expires.getTime(), db.rows[0].expiresAt.getTime());
  assert.ok(Math.abs(cookie.options.expires - Date.now() - 7 * 86400000) < 5000);
  const payload = jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET);
  assert.equal(payload.exp - payload.iat, 900);
  assert.deepEqual(authenticate(`Bearer ${accessToken}`).req.authUser, user);
  assert.equal(authenticate(`Bearer ${accessToken}`).nextCalls, 1);
});

test("middleware rejects missing, malformed, forged, expired and invalid claims", () => {
  const sign = (payload, options = {}, key = process.env.JWT_ACCESS_SECRET) =>
    jwt.sign(payload, key, { issuer: "bookme", audience: "bookme-api",
      expiresIn: 900, ...options });
  const claims = { sub: user.id, tenantId: user.tenantId };
  for (const header of [undefined, "Basic abc", "Bearer", "Bearer a b", "Bearer junk",
    `Bearer ${sign(claims, {}, "wrong-secret")}`,
    `Bearer ${sign(claims, { expiresIn: -1 })}`,
    `Bearer ${sign({ sub: user.id })}`,
    `Bearer ${sign(claims, { audience: "other-api" })}`,
    `Bearer ${jwt.sign(claims, process.env.JWT_ACCESS_SECRET)}`]) {
    const result = authenticate(header);
    assert.equal(result.res.statusCode, 401);
    assert.deepEqual(result.res.body, { error: "Unauthorized" });
    assert.equal(result.nextCalls, 0);
    assert.equal(result.req.authUser, undefined);
  }
});

test("rotation replaces once; replay revokes every live session for that user", async () => {
  const db = database();
  const initial = response();
  await createSession(initial, user, db);
  await createSession(response(), user, db); // A separate login session.
  const oldRaw = initial.cookies[0].value;
  const rotated = response();
  assert.ok(await rotateRefreshSession(rotated, oldRaw, db));
  assert.ok(db.rows[0].revokedAt instanceof Date);
  assert.equal(db.rows[0].replacedById, db.rows[2].id);
  assert.notEqual(rotated.cookies[0].value, oldRaw);
  assert.equal(db.rows[2].tokenHash, digest(rotated.cookies[0].value));
  const rejected = response();
  assert.equal(await rotateRefreshSession(rejected, oldRaw, db), null);
  assert.equal(rejected.cookies.length, 0);
  assert.ok(db.rows.every((row) => row.revokedAt instanceof Date));
  assert.equal(await rotateRefreshSession(response(), rotated.cookies[0].value, db), null);
});

test("unknown and expired refresh tokens issue no replacement", async () => {
  const db = database();
  const res = response();
  assert.equal(await rotateRefreshSession(res, "unknown", db), null);
  await createSession(res, user, db);
  db.rows[0].expiresAt = new Date(0);
  const expired = response();
  assert.equal(await rotateRefreshSession(expired, res.cookies[0].value, db), null);
  assert.equal(expired.cookies.length, 0);
  assert.equal(db.rows.length, 1);
});

test("logout is idempotent, clears the cookie and prevents refresh", async () => {
  const db = database();
  const res = response();
  await createSession(res, user, db);
  const raw = res.cookies[0].value;
  await revokeRefreshSession(res, raw, db);
  await revokeRefreshSession(res, raw, db);
  assert.ok(db.rows[0].revokedAt);
  assert.equal(res.cleared[0].options.path, "/api/auth");
  assert.equal(await rotateRefreshSession(response(), raw, db), null);
});

test("serialization conflicts retry; failed writes roll back without setting cookies", async () => {
  const db = database();
  const res = response();
  await createSession(res, user, db);
  const transaction = db.$transaction.bind(db);
  let attempts = 0;
  db.$transaction = (...args) => {
    if (++attempts === 1) throw new Prisma.PrismaClientKnownRequestError(
      "conflict", { code: "P2034", clientVersion: "test" });
    return transaction(...args);
  };
  assert.ok(await rotateRefreshSession(response(), res.cookies[0].value, db));
  assert.equal(attempts, 2);
  const db2 = database();
  const initial = response();
  await createSession(initial, user, db2);
  db2.refreshToken.update = async () => { throw new Error("write failed"); };
  const failed = response();
  await assert.rejects(rotateRefreshSession(failed, initial.cookies[0].value, db2), /write failed/);
  assert.equal(db2.rows.length, 1);
  assert.equal(db2.rows[0].revokedAt, null);
  assert.equal(failed.cookies.length, 0);
});

test("secure cookie policy and clearing attributes match", () => {
  try {
    process.env.CLIENT_ORIGIN = "https://bookme.example";
    const res = response();
    clearRefreshCookie(res);
    assert.equal(res.cleared[0].options.secure, true);
    assert.equal(res.cleared[0].options.httpOnly, true);
    assert.equal(res.cleared[0].options.sameSite, "lax");
    assert.equal(res.cleared[0].options.path, "/api/auth");
    process.env.CLIENT_ORIGIN = "http://localhost:5173";
    process.env.NODE_ENV = "production";
    clearRefreshCookie(res);
    assert.equal(res.cleared[1].options.secure, true);
  } finally {
    process.env.CLIENT_ORIGIN = "http://localhost:5173";
    process.env.NODE_ENV = "test";
  }
});
