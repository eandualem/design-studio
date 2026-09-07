import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const output = path.resolve(process.env.EVIDENCE_DIR ?? ".tmp/save-recovery");
const appUrl = process.env.DEMO_APP_URL ?? "http://localhost:7131";
const serverRoot = path.resolve(".tmp/xstate-mcp");
const serverRequire = createRequire(path.join(serverRoot, "package.json"));
const { Client } = await import(pathToFileURL(serverRequire.resolve("@modelcontextprotocol/sdk/client/index.js")));
const { StdioClientTransport } = await import(pathToFileURL(serverRequire.resolve("@modelcontextprotocol/sdk/client/stdio.js")));
fs.mkdirSync(output, { recursive: true });
let client;
let transport;
let context;
let page;
let connections = [];

function record(value) {
  fs.appendFileSync(path.join(output, "transcript.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
}

async function connect() {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(serverRoot, "dist/index.js")],
    stderr: "pipe",
    env: {
      PATH: process.env.PATH,
      XSTATE_MCP_WS_PORT: "7358",
      XSTATE_MCP_WS_HOST: "127.0.0.1",
      XSTATE_MCP_ALLOWED_ORIGINS: new URL(appUrl).origin,
      XSTATE_MCP_REQUIRE_ORIGIN: "true",
      XSTATE_MCP_READ_ONLY: "false",
      XSTATE_MCP_WRITE_ALLOW: JSON.stringify([{ actor: "*", events: ["user.edit", "user.retrySave"] }]),
      XSTATE_MCP_REDACTION: JSON.stringify({ keys: ["content", "input", "output", "error", "screenshot", "renderCache"] }),
    },
  });
  client = new Client({ name: "design-studio-coding-agent-evidence", version: "1.0.0" });
  await client.connect(transport);
  return { server: client.getServerVersion(), node: process.version };
}

async function browser() {
  context = await chromium.launchPersistentContext(path.join(output, "profile"), {
    channel: "chrome", headless: true,
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.join(output, "video"), size: { width: 1440, height: 900 } },
  });
  await context.route(/:7100\//, (route) => route.abort());
  await context.routeWebSocket(/:7100\//, (socket) => socket.close());
  await context.addInitScript(() => {
    const sockets = [];
    window.__inspectionSockets = sockets;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        if (this.url.includes(":7358")) sockets.push(this);
      }
    };
    const fixture = { remaining: 0, writes: 0, aborted: 0, committed: 0 };
    window.__saveRecoveryFixture = fixture;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args);
      if (this.transaction.db.name === "design-studio" && this.name === "documents") {
        fixture.writes++;
        this.transaction.addEventListener("complete", () => fixture.committed++);
        if (fixture.remaining > 0) {
          fixture.remaining--;
          fixture.aborted++;
          this.transaction.abort();
        }
      }
      return request;
    };
  });
  page = context.pages()[0] ?? await context.newPage();
  connections = [];
  page.on("websocket", (socket) => {
    const connection = { url: socket.url(), closed: false, frames: 0, containsDraft: false };
    connections.push(connection);
    socket.on("close", () => { connection.closed = true; });
    socket.on("socketerror", () => { connection.closed = true; });
    socket.on("framesent", ({ payload }) => {
      connection.frames++;
      if (socket.url().includes(":7358") && /Synthetic recovery|private-content|must survive/.test(String(payload))) connection.containsDraft = true;
    });
  });
  await page.goto(appUrl);
  return { browser: context.browser()?.version(), url: page.url(), fixture: "Real IndexedDB transaction.abort() injection; no runtime model calls" };
}

async function run(command) {
  switch (command.op) {
    case "connect": return connect();
    case "tools": return client.listTools();
    case "tool": return client.callTool({ name: command.name, arguments: command.arguments ?? {} });
    case "browser": return browser();
    case "click": {
      const locator = page.getByRole(command.role ?? "button", { name: command.name, exact: true });
      await (command.index === undefined ? locator : locator.nth(command.index)).click();
      return { clicked: command.name };
    }
    case "edit": await page.locator('textarea[spellcheck="false"]').fill(command.content); return { edited: command.content.length };
    case "fault": return page.evaluate((remaining) => Object.assign(window.__saveRecoveryFixture, { remaining }), command.count);
    case "view": return { url: page.url(), text: await page.locator("body").innerText(), fixture: await page.evaluate(() => window.__saveRecoveryFixture) };
    case "screenshot": {
      const filename = path.join(output, `${command.name}.png`);
      await page.screenshot({ path: filename });
      return { screenshot: filename };
    }
    case "reload": await page.reload(); return { reloaded: page.url() };
    case "navigate": await page.goto(command.url ?? appUrl); return { url: page.url() };
    case "connections": return {
      observed: connections,
      actual: await page.evaluate(() => window.__inspectionSockets?.map((socket) => ({ url: socket.url, readyState: socket.readyState })) ?? []),
    };
    case "unmount": await page.goto("about:blank"); return { unmounted: true };
    case "persisted": return page.evaluate(async () => {
      const request = indexedDB.open("design-studio");
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const rows = database.transaction("documents").objectStore("documents").getAll();
        return await new Promise((resolve, reject) => {
          rows.onsuccess = () => resolve(rows.result);
          rows.onerror = () => reject(rows.error);
        });
      } finally { database.close(); }
    });
    case "wait": await new Promise((resolve) => setTimeout(resolve, Math.min(command.ms, 60000))); return { waited: command.ms };
    case "disconnect": await client.close(); return { disconnected: true };
    case "closeBrowser": await context.close(); return { closed: true };
    case "quit": await context?.close(); await client?.close(); return { quit: true };
    default: throw new Error("Unknown evidence command");
  }
}

process.stdout.write(`${JSON.stringify({ ready: true, output, appUrl })}\n`);
for await (const line of readline.createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let command;
  try {
    command = JSON.parse(line);
    const result = await run(command);
    record({ request: command, result });
    const shown = command.show ? command.show.split(".").reduce((value, key) => value?.[key], result) : result;
    process.stdout.write(`${JSON.stringify({ result: shown })}\n`);
    if (command.op === "quit") process.exit(0);
  } catch (error) {
    const result = { error: String(error) };
    record({ request: command, result });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
