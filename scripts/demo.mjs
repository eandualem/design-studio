// The demo from the README, driven end to end in the installed Chrome.
// Needs the studio on :7130 and the runtime on :7100 with a provider key
// and ASSISTANT__PROFILE=profiles/design-studio.toml.
//
//   bun run demo                     # screenshots and demo.json/demo.md under .tmp/demo/
//   DEMO_STEPS=1,2,3 bun run demo
//
// Every step records: wall time from send to the first useful host action
// (or first text), time to turn end, whether the step needed a human hand,
// the host actions the assistant made, and the usage the panel shows.

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(".tmp/demo");
const APP = process.env.DEMO_APP_URL ?? "http://localhost:7130";
const RUNTIME = process.env.DEMO_RUNTIME_URL ?? "http://127.0.0.1:7100";
const ONLY = process.env.DEMO_STEPS ? new Set(process.env.DEMO_STEPS.split(",").map(Number)) : null;
const TURN_TIMEOUT_MS = 180_000;

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const now = () => Date.now();

// Preflight: both processes must be up, or the run cannot mean anything.
async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status < 500 || url.endsWith("/health");
  } catch {
    return false;
  }
}
const problems = [];
if (!(await reachable(`${RUNTIME}/health`))) {
  problems.push(
    `runtime not reachable at ${RUNTIME}\n    start it:\n    ASSISTANT__PROFILE=${path.resolve("profiles/design-studio.toml")} assistant-runtime serve --port 7100`,
  );
} else {
  const health = await (await fetch(`${RUNTIME}/health`)).json().catch(() => null);
  const llm = health?.components?.llm_service;
  if (llm && llm.healthy === false && process.env.DEMO_ALLOW_NO_KEY !== "1") {
    problems.push(
      `runtime has no usable provider (llm_service unhealthy): put a provider key in the runtime's .env and restart it (DEMO_ALLOW_NO_KEY=1 runs anyway, every turn will fail)`,
    );
  }
}
if (!(await reachable(APP))) {
  problems.push(`studio not reachable at ${APP}\n    start it in another terminal:  bun run dev`);
}
if (problems.length > 0) {
  console.error("demo cannot start:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// A persistent profile keeps IndexedDB (the documents) and localStorage (the
// lobby session) across runs, so DEMO_STEPS can continue a previous run.
const browser = await chromium.launchPersistentContext(path.join(OUT, "profile"), {
  channel: "chrome",
  headless: process.env.DEMO_HEADED !== "1",
  viewport: { width: 1440, height: 900 },
});
const page = browser.pages()[0] ?? (await browser.newPage());

/** Every assistant_message body sent and every server event received, for the report. */
const wire = { sent: [], received: [] };
page.on("websocket", (ws) => {
  ws.on("framesent", (f) => {
    const p = String(f.payload);
    if (p.includes("assistant_message")) wire.sent.push({ t: now(), body: JSON.parse(p.slice(p.indexOf("[")))[1] });
  });
  ws.on("framereceived", (f) => {
    const p = String(f.payload);
    const m = /^\d+\/assistant,(\[.*)$/s.exec(p);
    if (!m) return;
    try {
      const [name, payload] = JSON.parse(m[1]);
      if (typeof name === "string" && name.startsWith("assistant:")) wire.received.push({ t: now(), name, payload });
    } catch {
      /* not JSON */
    }
  });
});

const results = [];
const input = () => page.locator("textarea").last();

async function waitIdle(sinceIndex) {
  const t0 = now();
  for (;;) {
    const events = wire.received.slice(sinceIndex);
    const completed = events.filter((e) => e.name === "assistant:status" && e.payload.status === "completed");
    const pendingCalls = events.filter((e) => e.name === "assistant:final_response" && e.payload.pending_tool_call);
    // a turn with N host actions ends with N+1 completed envelopes
    if (completed.length > pendingCalls.length && (await input().isEnabled())) return;
    if (now() - t0 > TURN_TIMEOUT_MS) throw new Error("turn did not end in time");
    await page.waitForTimeout(150);
  }
}

async function send(text, { steer } = {}) {
  await input().fill(text);
  await page.keyboard.press("Enter");
  if (!steer) await page.waitForTimeout(100);
}

function summarizeTurn(sinceSent, sinceRecv, t0) {
  const events = wire.received.slice(sinceRecv);
  const firstUseful = events.find(
    (e) => (e.name === "assistant:tool_call" && e.payload.category === "host") || e.name === "assistant:text_delta",
  );
  const finals = events.filter((e) => e.name === "assistant:final_response");
  // a final_response after a continuation carries the cumulative usage of its
  // assistant message, so keep only the last usage seen per message_id
  const lastUsage = new Map();
  for (const e of finals) if (e.payload.usage) lastUsage.set(e.payload.message_id ?? e.t, e.payload.usage);
  const usage = [...lastUsage.values()];
  const cost = usage.reduce((s, u) => (u.cost_usd == null ? s : s + u.cost_usd), 0);
  const tokens = usage.reduce((s, u) => s + (u.input_tokens ?? 0) + (u.output_tokens ?? 0), 0);
  return {
    firstUsefulMs: firstUseful ? firstUseful.t - t0 : null,
    turnEndMs: events.length ? events[events.length - 1].t - t0 : null,
    hostActions: events.filter((e) => e.name === "assistant:tool_call" && e.payload.category === "host").map((e) => e.payload.tool_name),
    continuations: wire.sent.slice(sinceSent).filter((s) => s.body.tool_call_id).map((s) => s.body.tool_outcome ?? "success"),
    errors: events.filter((e) => e.name === "assistant:error").map((e) => e.payload.error_type),
    tokens,
    costUsd: usage.some((u) => u.cost_usd != null) ? cost : null,
  };
}

async function step(n, title, run) {
  if (ONLY && !ONLY.has(n)) return;
  log(`step ${n}: ${title}`);
  const sinceSent = wire.sent.length;
  const sinceRecv = wire.received.length;
  const t0 = now();
  let assistance = "none";
  let note = "";
  try {
    const r = await run({ sinceRecv });
    if (r?.assistance) assistance = r.assistance;
    if (r?.note) note = r.note;
  } catch (error) {
    note = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
    log("  ", note);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, "0")}.png`) });
  const summary = summarizeTurn(sinceSent, sinceRecv, t0);
  results.push({ step: n, title, assistance, note, ...summary });
  log("  ", JSON.stringify(summary));
}

await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
if (ONLY && !ONLY.has(1)) {
  // continuing a previous run: reopen the most recent document and its conversation
  const first = page.locator("nav [title='Double-click to rename']").first();
  if ((await first.count()) > 0) {
    await first.click();
    await page.waitForURL(/\/d\//, { timeout: 5000 });
    await page.waitForSelector("textarea:not([disabled])", { timeout: 15000 });
    await page.waitForTimeout(1500);
  }
}

await step(1, "New document with a payment-service flowchart", async ({ sinceRecv }) => {
  await send("Design a payment service with an API, a worker, Postgres and a queue.");
  await waitIdle(sinceRecv);
  await page.waitForURL(/\/d\//, { timeout: 5000 }).catch(() => {});
  await page.waitForSelector(".diagram svg", { timeout: 10000 }).catch(() => {});
});

await step(2, "Left to right with a dead-letter queue", async ({ sinceRecv }) => {
  await send("Make it left to right and add a dead-letter queue.");
  await waitIdle(sinceRecv);
});

await step(3, "A request that yields a Mermaid parse error, repaired in the same turn", async ({ sinceRecv }) => {
  await send("Label the edge from the worker to the queue with the text: retry (max 3) [dead-letter after]. Keep the rest.");
  await waitIdle(sinceRecv);
  const events = wire.received.slice(sinceRecv);
  const failedRender = wire.sent
    .filter((s) => s.body.tool_call_id)
    .some((s) => JSON.stringify(s.body.tool_result).includes('"ok":false'));
  return { note: failedRender ? "render error reported and repaired" : `no render error occurred (${events.length} events)` };
});

await step(4, "Try a variant of step 2 as a sequence diagram", async ({ sinceRecv }) => {
  await page.hover("text=Make it left to right and add a dead-letter queue.");
  await page.click("button[title='Send a different message from this point']");
  await send("Make it left to right and add a dead-letter queue, as a sequence diagram.");
  await waitIdle(sinceRecv);
  await page.waitForSelector("text=2/2", { timeout: 5000 });
  await page.click("button[title='Previous variant']");
  await page.waitForSelector("text=1/2", { timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, "04b-variant-1.png") });
  await page.click("button[title='Next variant']");
  await page.waitForSelector("text=2/2", { timeout: 10000 });
});

await step(5, "Steer mid-stream, then cancel a long rewrite", async ({ sinceRecv }) => {
  await send("In the chat, not the document: write a long, detailed description of every component in this design, at least three paragraphs each, starting immediately.");
  await page.waitForSelector("textarea[placeholder='Nudge the assistant…']", { timeout: 20000 });
  await send("use British spelling", { steer: true });
  const t0 = now();
  while (now() - t0 < 60000 && !wire.received.slice(sinceRecv).some((e) => e.name === "assistant:text_delta")) {
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2500);
  await page.click("button[title='Stop generating']");
  await waitIdle(sinceRecv);
  const cancelled = wire.received.slice(sinceRecv).some((e) => e.name === "assistant:final_response" && e.payload.error_type === "cancelled");
  return { note: cancelled ? "cancelled; partial text kept" : "turn ended before cancel" };
});

await step(6, "Drop a whiteboard photo and turn it into a diagram", async ({ sinceRecv }) => {
  const photo = process.env.DEMO_PHOTO ?? path.resolve(".tmp/demo/whiteboard.png");
  if (!fs.existsSync(photo)) return { assistance: "skipped", note: `no photo at ${photo}` };
  await page.setInputFiles("input[type=file]", photo);
  await page.waitForSelector("img[alt]");
  await send("Turn this whiteboard photo into a diagram in a new section.");
  await waitIdle(sinceRecv);
});

await step(7, "Look at the preview", async ({ sinceRecv }) => {
  await page.click("text=Preview");
  await page.waitForTimeout(2500);
  await send("Look at the preview: is the queue readable?");
  await waitIdle(sinceRecv);
  const looked = wire.received.slice(sinceRecv).some((e) => e.name === "assistant:tool_call" && e.payload.tool_name === "look_at_screen");
  return { note: looked ? "look_at_screen called" : "look_at_screen not called" };
});

await step(8, "Reload while a host action is pending", async ({ sinceRecv }) => {
  await send("Add a monitoring section with a flowchart of alerts, then a second diagram of the on-call rota.");
  const t0 = now();
  while (now() - t0 < TURN_TIMEOUT_MS) {
    if (wire.received.slice(sinceRecv).some((e) => e.name === "assistant:final_response" && e.payload.pending_tool_call)) break;
    await page.waitForTimeout(50);
  }
  const sid = wire.sent[wire.sent.length - 1].body.session_id;
  const before = await (await fetch(`${RUNTIME}/api/sessions/${sid}`)).json();
  const sentBefore = wire.sent.length;
  await page.reload({ waitUntil: "networkidle" });
  const recv = wire.received.length;
  await waitIdle(recv).catch(() => {});
  const after = await (await fetch(`${RUNTIME}/api/sessions/${sid}`)).json();
  const recovered = wire.sent.slice(sentBefore).filter((m) => m.body.tool_call_id).map((m) => m.body.tool_outcome ?? "success");
  return {
    note: `pending before reload: ${before.pending_action?.tool_name ?? "none"}; continuations sent by the reloaded page: ${recovered.join(", ") || "none"}; pending after: ${after.pending_action?.tool_name ?? "none"}`,
  };
});

await step(9, "A lasting preference becomes a style-guide proposal, approved in the artifacts view", async ({ sinceRecv }) => {
  await send("From now on, always put a small legend subgraph at the bottom right of every architecture flowchart. Apply it here too.");
  await waitIdle(sinceRecv);
  await page.click("button[title='Assistant style guide and artifacts']");
  await page.waitForSelector("text=Diagram Style Guide", { timeout: 10000 });
  const proposals = await page.locator("button:has-text('Approve')").count();
  if (proposals > 0) {
    await page.click("button:has-text('Approve')");
    await page.waitForSelector("text=Proposed version", { state: "detached", timeout: 10000 }).catch(() => {});
  }
  await page.screenshot({ path: path.join(OUT, "09b-style-guide.png") });
  await page.click("text=Back to chat");
  const r2 = wire.received.length;
  await send("Add a small cache next to the API in the architecture diagram.");
  await waitIdle(r2);
  return { note: proposals > 0 ? "proposal approved" : "no proposal was made" };
});

await step(10, "Cost is visible per message and per session", async () => {
  const usage = page.locator("span[title='Session usage']");
  const header = (await usage.count()) > 0 ? await usage.innerText() : "";
  return { note: header ? `session usage: ${header}` : "no session usage shown" };
});

fs.writeFileSync(path.join(OUT, "demo.json"), JSON.stringify({ results, wire }, null, 2));
const rows = results.map(
  (r) =>
    `| ${r.step} | ${r.title} | ${r.firstUsefulMs ?? "–"} | ${r.turnEndMs ?? "–"} | ${r.assistance} | ${r.hostActions.join(", ") || "–"} | ${r.errors.join(", ") || "–"} | ${r.tokens} | ${r.costUsd == null ? "n/a" : `$${r.costUsd.toFixed(4)}`} | ${r.note} |`,
);
fs.writeFileSync(
  path.join(OUT, "demo.md"),
  [
    "| Step | What | First useful action (ms) | Turn end (ms) | Assistance | Host actions | Errors | Tokens | Cost | Note |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n") + "\n",
);
log("written", path.join(OUT, "demo.md"));
await browser.close();
