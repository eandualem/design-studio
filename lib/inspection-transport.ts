const MAX_FRAME_BYTES = 64 * 1024;
const MAX_RETAINED_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 100;

export function createInspectionTransport(url: string, onCommand: (data: unknown) => void) {
  const registrations = new Map<string, string>();
  const snapshots = new Map<string, string>();
  const recent: string[] = [];
  let retainedBytes = 0;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 250;
  let active = false;
  const bytes = (frame: string) => new TextEncoder().encode(frame).length;

  function send(frame: string) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount + bytes(frame) > MAX_RETAINED_BYTES) {
      socket.close();
      return false;
    }
    socket.send(frame);
    return true;
  }

  function forget(sessionId: string) {
    for (const frames of [registrations, snapshots]) {
      const previous = frames.get(sessionId);
      if (previous) retainedBytes -= bytes(previous);
      frames.delete(sessionId);
    }
  }

  function connect() {
    if (!active || socket) return;
    const current = new WebSocket(url);
    socket = current;
    current.addEventListener("open", () => {
      if (!active || socket !== current) return;
      retryDelay = 250;
      for (const frame of registrations.values()) send(frame);
      for (const frame of recent.splice(0)) {
        retainedBytes -= bytes(frame);
        send(frame);
      }
      for (const frame of snapshots.values()) send(frame);
    });
    current.addEventListener("message", (message) => {
      if (!active || socket !== current || typeof message.data !== "string") return;
      if (bytes(message.data) > MAX_FRAME_BYTES) return;
      try {
        onCommand(JSON.parse(message.data));
      } catch {
        return;
      }
    });
    current.addEventListener("close", () => {
      if (socket !== current) return;
      socket = undefined;
      if (active) {
        retry = setTimeout(connect, retryDelay);
        retryDelay = Math.min(4000, retryDelay * 2);
      }
    });
    current.addEventListener("error", () => current.close());
  }

  return {
    start() {
      active = true;
      connect();
    },
    stop() {
      active = false;
      clearTimeout(retry);
      const previous = socket;
      socket = undefined;
      previous?.close();
    },
    clear() {
      registrations.clear();
      snapshots.clear();
      recent.length = 0;
      retainedBytes = 0;
    },
    forget,
    publish(kind: "actor" | "snapshot" | "event", sessionId: string, frame: string) {
      const size = bytes(frame);
      if (size > MAX_FRAME_BYTES) return;
      if (kind === "event") {
        if (send(frame)) return;
        while (recent.length && (recent.length >= MAX_EVENTS || retainedBytes + size > MAX_RETAINED_BYTES)) {
          retainedBytes -= bytes(recent.shift()!);
        }
        if (retainedBytes + size > MAX_RETAINED_BYTES) return;
        recent.push(frame);
        retainedBytes += size;
      } else {
        const frames = kind === "actor" ? registrations : snapshots;
        const previous = frames.get(sessionId);
        if (previous) retainedBytes -= bytes(previous);
        frames.delete(sessionId);
        if (retainedBytes + size > MAX_RETAINED_BYTES) return;
        frames.set(sessionId, frame);
        retainedBytes += size;
        send(frame);
      }
    },
    respond(value: unknown) {
      send(JSON.stringify(value));
    },
  };
}
