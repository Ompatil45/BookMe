import { spawnSync } from "node:child_process";
import path from "path";
import { fileURLToPath } from "url";
import { loadServerEnv } from "./load-env.mjs";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadServerEnv();

const args = process.argv.slice(2);
const result = spawnSync("npx", ["prisma", ...args], {
  cwd: serverDir,
  stdio: "inherit",
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
