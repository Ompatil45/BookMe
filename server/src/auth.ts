import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { CookieOptions, NextFunction, Request, Response } from "express";
import { Prisma, type PrismaClient } from "../prisma/generated/index.js";

const ACCESS_SECONDS = 15 * 60;
const REFRESH_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_ISSUER = "bookme";
const TOKEN_AUDIENCE = "bookme-api";

type AuthUser = { id: string; tenantId: string };

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

// index.ts loads dotenv after importing this module, so read secrets at call time.
function secret(name: "JWT_ACCESS_SECRET" | "JWT_REFRESH_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function refreshCookieOptions(): CookieOptions {
  const hostname = new URL(
    process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  ).hostname;
  const localhost = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || !localhost,
    path: "/api/auth",
  };
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie("refreshToken", refreshCookieOptions());
}

function setRefreshCookie(res: Response, raw: string, expiresAt: Date): void {
  res.cookie("refreshToken", raw, {
    ...refreshCookieOptions(),
    expires: expiresAt,
  });
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function signAccessToken(user: AuthUser): string {
  return jwt.sign({ tenantId: user.tenantId }, secret("JWT_ACCESS_SECRET"), {
    algorithm: "HS256",
    subject: user.id,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn: ACCESS_SECONDS,
  });
}

function hashRefreshToken(raw: string): string {
  return createHmac("sha256", secret("JWT_REFRESH_SECRET"))
    .update(raw)
    .digest("hex");
}

function newRefreshToken() {
  const raw = randomBytes(32).toString("hex");
  return {
    raw,
    tokenHash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + REFRESH_MILLISECONDS),
  };
}

export async function createSession(
  res: Response,
  user: AuthUser,
  prisma: PrismaClient,
): Promise<{ accessToken: string }> {
  const accessToken = signAccessToken(user);
  const refresh = newRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
    },
  });
  setRefreshCookie(res, refresh.raw, refresh.expiresAt);
  return { accessToken };
}

export async function rotateRefreshSession(
  res: Response,
  raw: string,
  prisma: PrismaClient,
): Promise<{ accessToken: string } | null> {
  const tokenHash = hashRefreshToken(raw);

  // Serializable transactions prevent concurrent refreshes from branching a
  // token's replacement chain. Retry conflicts against the newly committed state.
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const stored = await tx.refreshToken.findUnique({
            where: { tokenHash },
            select: {
              id: true,
              userId: true,
              expiresAt: true,
              revokedAt: true,
              user: { select: { id: true, tenantId: true } },
            },
          });
          if (!stored) return null;

          const now = new Date();
          if (stored.revokedAt !== null) {
            // Reuse is a possible theft signal: revoke every live user session.
            // Return normally so this revocation commits rather than rolls back.
            await tx.refreshToken.updateMany({
              where: { userId: stored.userId, revokedAt: null },
              data: { revokedAt: now },
            });
            return null;
          }
          if (stored.expiresAt <= now) return null;

          const refresh = newRefreshToken();
          const accessToken = signAccessToken(stored.user);
          const replacement = await tx.refreshToken.create({
            data: {
              userId: stored.userId,
              tokenHash: refresh.tokenHash,
              expiresAt: refresh.expiresAt,
            },
          });
          await tx.refreshToken.update({
            where: { id: stored.id },
            data: { revokedAt: now, replacedById: replacement.id },
          });
          return { accessToken, refresh };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!result) return null;
      // Send the replacement only after the transaction has committed.
      setRefreshCookie(res, result.refresh.raw, result.refresh.expiresAt);
      return { accessToken: result.accessToken };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3
      ) {
        continue;
      }
      throw error;
    }
  }
}

export async function revokeRefreshSession(
  res: Response,
  raw: string,
  prisma: PrismaClient,
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  clearRefreshCookie(res);
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  // A missing server secret is a configuration error, not a bad credential.
  const accessSecret = secret("JWT_ACCESS_SECRET");
  const match = /^Bearer ([^\s]+)$/i.exec(req.get("Authorization") ?? "");
  if (!match) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(match[1]!, accessSecret, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.tenantId !== "string" ||
      !payload.tenantId ||
      typeof payload.exp !== "number"
    ) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.authUser = { id: payload.sub, tenantId: payload.tenantId };
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
