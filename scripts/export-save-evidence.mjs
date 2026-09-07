import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const destination = path.resolve("docs/evidence/save-recovery");
fs.mkdirSync(destination, { recursive: true });
const transcript = [];
for (const phase of ["baseline", "after", "lifecycle", "production"]) {
  const source = path.resolve(`.tmp/save-recovery-${phase}`);
  const rows = fs.readFileSync(path.join(source, "transcript.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  for (const row of rows) {
    if (row.request.op === "tool") {
      let result = row.result.structuredContent ?? row.result;
      let excerptPath;
      if (row.request.name === "get_machine_definition" && result.definition) {
        excerptPath = result.definition.states.open.states.saveFailed
          ? "definition.states.open.states.saveFailed"
          : "definition.states.open.states.saving";
        result = { sessionId: result.sessionId, name: result.name, excerpt: excerptPath.split(".").reduce((value, key) => value[key], result) };
      }
      transcript.push({ at: row.at, phase, request: { name: row.request.name, arguments: row.request.arguments ?? {} }, result, isError: row.result.isError ?? false, excerptPath });
    } else if (["connect", "connections", "persisted", "fault", "view"].includes(row.request.op) && !row.result.error) {
      transcript.push({ ...row, phase });
    }
  }
  for (const filename of fs.readdirSync(source).filter((filename) => filename.endsWith(".png"))) {
    fs.copyFileSync(path.join(source, filename), path.join(destination, filename));
  }
}
fs.writeFileSync(path.join(destination, "transcript.jsonl"), transcript.map((row) => JSON.stringify(row)).join("\n") + "\n");
const versions = (root, packages) => Object.fromEntries(packages.map((name) => [name, JSON.parse(fs.readFileSync(path.join(root, name, "package.json"))).version]));
fs.writeFileSync(path.join(destination, "versions.json"), JSON.stringify({
  baseline: "e1bd77533decbb0a139c152cd5c0a8ae8d3eca81",
  codeCommit: "0da1b6a",
  inspectorSource: "16c7a0004dce3f676eab0b5606be1e3542c89449",
  integration: "unmerged development source; not a published release",
  serverPackageVersion: "1.0.1",
  serverHandshakeVersion: "1.0.0",
  node: process.version,
  nodeExecutable: process.execPath,
  bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
  browser: "Chrome 152.0.7977.77",
  app: versions("node_modules", ["next", "react", "react-dom", "xstate", "@xstate/react", "idb-keyval", "vitest", "playwright-core", "zod"]),
  server: versions(".tmp/xstate-mcp/node_modules", ["@modelcontextprotocol/sdk", "ws", "zod", "xstate"]),
  codingAgent: { runtime: "Codex CLI", model: "GPT-6 (system identification; exact deployment ID unavailable)", cost: "unavailable", usage: "unavailable" },
  inAppModelCalls: 0,
  faults: "Synthetic fixture calling the real IndexedDB transaction.abort()",
}, null, 2) + "\n");
process.stdout.write(`${destination}\n`);
