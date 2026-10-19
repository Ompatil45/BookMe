import { spawn } from "node:child_process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const children = ["dev:client", "dev:server"].map((script) =>
  spawn(npmCmd, ["run", script], { stdio: "inherit" }),
);

function shutdown() {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (signal) return;
    shutdown();
    process.exit(code ?? 0);
  });
}
