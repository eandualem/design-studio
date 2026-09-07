import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assign, createActor, fromPromise, setup } from "xstate";
import { createDevelopmentInspector } from "@/context/development-inspector";

class Socket extends EventTarget {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  sent: string[] = [];
  constructor() { super(); Socket.instances.push(this); }
  send(frame: string) { this.sent.push(frame); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubGlobal("WebSocket", Socket);
  Socket.instances = [];
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function harness() {
  const inspector = createDevelopmentInspector("ws://127.0.0.1:7358");
  const child = setup({ actors: { worker: fromPromise(async () => "private-output") } }).createMachine({
    id: "document",
    context: { document: { id: "synthetic", content: "private-content" }, blocks: [], saveError: "private-error" },
    initial: "open",
    states: {
      open: {
        invoke: { src: "worker" },
        on: { "user.edit": { target: "saved", actions: assign({ document: ({ event }) => ({ id: "synthetic", content: event.content }) }) } },
      },
      saved: {},
    },
  });
  const parent = createActor(setup({ actors: { child } }).createMachine({
    id: "app",
    context: ({ spawn }) => ({ child: spawn("child", { id: "document" }) }),
  }), { inspect: inspector.inspect });
  parent.start();
  inspector.start(parent);
  const socket = Socket.instances[0];
  socket.open();
  return { parent, inspector, socket };
}

it("inspects real root, spawned and invoked actors without transferring private payloads", async () => {
  const { parent, inspector, socket } = harness();
  await Promise.resolve();
  const frames = socket.sent.map((frame) => JSON.parse(frame));
  const registrations = frames.filter((frame) => frame.type === "@xstate.actor");
  expect(registrations).toHaveLength(3);
  const root = registrations.find((frame) => frame.name === "app");
  const document = registrations.find((frame) => frame.name === "document");
  const worker = registrations.find((frame) => frame.parentId === document.sessionId);
  expect(document.parentId).toBe(root.sessionId);
  expect(document.definition.states.open.on["user.edit"]).toBeDefined();
  expect(document.definition.states.open.on["user.edit"][0].target).toEqual(["document.saved"]);
  expect(worker.definition).toBeUndefined();
  expect(socket.sent.join("\n")).not.toContain("private-");
  parent.stop();
  inspector.stop();
});

it("denies disabled, malformed and wrong-actor commands but dispatches a validated edit", () => {
  const { parent, inspector, socket } = harness();
  const registrations = socket.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "@xstate.actor");
  const document = registrations.find((frame) => frame.name === "document");
  const root = registrations.find((frame) => frame.name === "app");
  const dispatch = (sessionId: string, event: Record<string, unknown>) => {
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "xstate-mcp.send", requestId: "request", sessionId, event }) }));
    return JSON.parse(socket.sent.at(-1)!);
  };
  expect(dispatch(document.sessionId, { type: "user.retrySave" }).success).toBe(false);
  expect(dispatch(document.sessionId, { type: "user.edit", content: "x", extra: true }).success).toBe(false);
  expect(dispatch(root.sessionId, { type: "user.edit", content: "x" }).success).toBe(false);
  expect(dispatch(document.sessionId, { type: "user.edit", content: "synthetic edit" }).success).toBe(true);
  expect(parent.getSnapshot().context.child.getSnapshot().context.document.content).toBe("synthetic edit");
  parent.stop();
  inspector.stop();
});

it("replays the current tree through StrictMode restart and clears it on final unmount", async () => {
  const { parent, inspector } = harness();
  inspector.stop();
  inspector.start(parent);
  await Promise.resolve();
  Socket.instances[1].open();
  expect(Socket.instances[1].sent.filter((frame) => JSON.parse(frame).type === "@xstate.actor")).toHaveLength(3);
  parent.stop();
  inspector.stop();
  await Promise.resolve();
  inspector.start(parent);
  Socket.instances[2].open();
  expect(Socket.instances[2].sent).toEqual([]);
  inspector.stop();
});

it("never connects when built for production", () => {
  vi.stubEnv("NODE_ENV", "production");
  const inspector = createDevelopmentInspector("ws://127.0.0.1:7358");
  inspector.start(createActor(setup({}).createMachine({})));
  expect(Socket.instances).toHaveLength(0);
  inspector.stop();
});

it("discards actors created by an abandoned StrictMode render before connecting", () => {
  const inspector = createDevelopmentInspector("ws://127.0.0.1:7358");
  const machine = setup({}).createMachine({ id: "root" });
  createActor(machine, { inspect: inspector.inspect });
  const committed = createActor(machine, { inspect: inspector.inspect });
  committed.start();
  inspector.start(committed);
  const socket = Socket.instances[0];
  socket.open();
  expect(socket.sent.filter((frame) => JSON.parse(frame).type === "@xstate.actor")).toHaveLength(1);
  committed.stop();
  inspector.stop();
});
