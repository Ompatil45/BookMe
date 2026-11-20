import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PrismaClient } from "../prisma/generated/index.js";

// Run after building, with BOOKME_TEST_DATABASE_URL pointing at a disposable
// database branch. Each run creates its own schema; existing rows are untouched.
test("concurrent signups create exactly one owner and one session", {
  skip: !process.env.BOOKME_TEST_DATABASE_URL,
  timeout: 180_000,
}, async (t) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const connection = new URL(process.env.BOOKME_TEST_DATABASE_URL);
  connection.searchParams.set("schema", `signup_test_${randomBytes(8).toString("hex")}`);
  const env = {
    ...process.env,
    DATABASE_URL: connection.href,
    JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
    JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
    CLIENT_ORIGIN: "http://localhost:5173",
    NODE_ENV: "test",
  };
  const migration = spawnSync(process.execPath, [
    "node_modules/prisma/build/index.js", "migrate", "deploy",
    "--schema", "server/prisma/schema.prisma",
  ], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  assert.equal(migration.status, 0, "Test schema migrations must succeed");

  const db = new PrismaClient({ datasourceUrl: connection.href });
  t.after(() => db.$disconnect());
  await db.tenant.create({ data: { name: "Signup Test", slug: "demo-studio" } });

  const portReservation = createServer();
  portReservation.listen(0, "127.0.0.1");
  await once(portReservation, "listening");
  env.PORT = String(portReservation.address().port);
  await new Promise((resolve, reject) => portReservation.close(error => error ? reject(error) : resolve()));

  // Keep the application code intact while preventing its dotenv calls from
  // overriding the isolated connection and test secrets in this child process.
  const entry = new URL("../dist/index.js", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "--eval",
    `import dotenv from "dotenv"; dotenv.config = () => ({ parsed: {} }); await import(${JSON.stringify(entry)});`,
  ], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(child, "exit");
  t.after(async () => { if (child.exitCode === null) child.kill(); await exit; });
  child.stderr.resume();
  const ready = await Promise.race([
    new Promise(resolve => child.stdout.on("data", chunk => {
      if (chunk.toString().includes("Server listening")) resolve(true);
    })),
    exit.then(() => false),
    new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 10_000);
      timer.unref();
    }),
  ]);
  assert.equal(ready, true, "Test API must start");

  for (const sameEmail of [false, true]) {
    await t.test(sameEmail ? "same email" : "different emails", async () => {
      // These rows belong exclusively to this run's randomly named schema.
      await db.user.deleteMany();
      const password = randomBytes(18).toString("hex");
      const responses = await Promise.all([0, 1].map(index => fetch(
        `http://127.0.0.1:${env.PORT}/api/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Owner", password,
            email: `owner${sameEmail ? 0 : index}@example.com` }),
          signal: AbortSignal.timeout(30_000),
        },
      )));
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      const winner = responses.find(response => response.status === 201);
      const loser = responses.find(response => response.status === 409);
      assert.ok(winner.headers.get("set-cookie")?.includes("refreshToken="));
      assert.equal(loser.headers.get("set-cookie"), null);
      assert.deepEqual(await loser.json(), { error: "User already exists" });
      assert.equal(await db.user.count(), 1);
      assert.equal(await db.refreshToken.count(), 1);
    });
  }
});
