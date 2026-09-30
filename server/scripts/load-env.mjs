import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverDir, "..");

/** Server defaults first; repo-root `.env.local` (Neon) overrides `DATABASE_URL`. */
export function loadServerEnv() {
  config({ path: path.join(serverDir, ".env") });
  config({ path: path.join(repoRoot, ".env.local"), override: true });
}
