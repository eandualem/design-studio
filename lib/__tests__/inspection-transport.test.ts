import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInspectionTransport } from "@/lib/inspection-transport";

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  sent: string[] = [];
  constructor() {
    super();
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  send(frame: string) { this.sent.push(frame); }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("inspection transport", () => {
  it("replays registrations and the latest snapshots after bounded offline history", () => {
    const transport = createInspectionTransport("ws://127.0.0.1:7358", vi.fn());
    transport.publish("actor", "root", "root definition");
    transport.publish("actor", "child", "child definition");
    transport.publish("snapshot", "child", "old snapshot");
    for (let index = 0; index < 150; index++) transport.publish("event", "child", `event ${index}`);
    transport.publish("snapshot", "child", "latest snapshot");
    expect(FakeSocket.instances).toHaveLength(0);
    transport.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    expect(socket.sent).toHaveLength(103);
    expect(socket.sent.slice(0, 3)).toEqual(["root definition", "child definition", "event 50"]);
    expect(socket.sent.at(-1)).toBe("latest snapshot");
    transport.stop();
  });

  it("cancels reconnect on cleanup and permits a StrictMode restart", () => {
    const transport = createInspectionTransport("ws://127.0.0.1:7358", vi.fn());
    transport.start();
    FakeSocket.instances[0].close();
    transport.stop();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(1);
    transport.start();
    transport.start();
    expect(FakeSocket.instances).toHaveLength(2);
    transport.stop();
  });

  it("bounds retained bytes and frames, clears snapshots and rejects oversized commands", () => {
    const onCommand = vi.fn();
    const transport = createInspectionTransport("ws://127.0.0.1:7358", onCommand);
    transport.publish("actor", "large", "x".repeat(65537));
    for (let index = 0; index < 100; index++) transport.publish("event", "child", "x".repeat(65536));
    transport.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    expect(socket.sent).toHaveLength(32);
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify("x".repeat(65536)) }));
    socket.dispatchEvent(new MessageEvent("message", { data: "invalid json" }));
    expect(onCommand).not.toHaveBeenCalled();
    transport.stop();
    transport.clear();
    transport.start();
    FakeSocket.instances[1].open();
    expect(FakeSocket.instances[1].sent).toEqual([]);
    transport.stop();
  });
});
