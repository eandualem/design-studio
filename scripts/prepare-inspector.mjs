import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const installed = path.resolve("node_modules/xstate-mcp");
const source = path.resolve(".tmp/xstate-mcp");
fs.mkdirSync(source, { recursive: true });
fs.cpSync(installed, source, {
  recursive: true,
  filter: (filename) => !["node_modules", "dist"].includes(path.relative(installed, filename).split(path.sep)[0]),
});
execFileSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: source, stdio: "inherit" });
execFileSync("bun", ["run", "build"], { cwd: source, stdio: "inherit" });
fs.cpSync(path.join(source, "dist"), path.join(installed, "dist"), { recursive: true });
