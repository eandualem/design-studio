import type { AnyActor, InspectionEvent } from "xstate";
import { createInspectionGuard } from "xstate-mcp/inspection-policy";
import { createInspectionTransport } from "@/lib/inspection-transport";
import { InspectionCommandSchema, InspectionDocumentEventSchema } from "@/types";

const MAX_ACTORS = 128;

export function createDevelopmentInspector(url: string) {
  const actors = new Map<string, AnyActor>();
  const epoch = crypto.randomUUID();
  const wireId = (sessionId: string) => `${epoch}:${sessionId}`;
  let active = false;
  const guard = createInspectionGuard({
    enabled: process.env.NODE_ENV === "development",
    writePolicy: { readOnly: false, allow: [{ actor: "*", events: ["user.edit", "user.retrySave"] }] },
    redaction: { keys: ["content", "input", "output", "error", "screenshot", "renderCache"] },
  });
  const transport = createInspectionTransport(url, (data) => {
    const parsed = InspectionCommandSchema.safeParse(data);
    if (!parsed.success) return;
    const command = parsed.data;
    const actor = actors.get(command.sessionId);
    const event = InspectionDocumentEventSchema.safeParse(command.event);
    const snapshot = actor?.getSnapshot();
    const permitted = actor?.id === "document" && event.success && snapshot?.status === "active" && snapshot.can(event.data);
    const result = permitted
      ? guard.dispatch(actor, { ...command, sessionId: actor.sessionId, event: event.data })
      : { success: false, code: "invalid_demo_command", error: "Only enabled document edits and retries are permitted" };
    transport.respond({ type: "xstate-mcp.send.response", requestId: command.requestId, ...result });
  });

  function inspect(event: InspectionEvent) {
    if (!guard.enabled || !["@xstate.actor", "@xstate.snapshot", "@xstate.event"].includes(event.type)) return;
    const actor = event.actorRef as AnyActor;
    const sessionId = wireId(actor.sessionId);
    if (!actors.has(sessionId)) {
      if (actors.size >= MAX_ACTORS) {
        const stopped = [...actors].find(([, tracked]) => tracked.getSnapshot()?.status !== "active");
        if (!stopped) return;
        actors.delete(stopped[0]);
        transport.forget(stopped[0]);
      }
      actors.set(sessionId, actor);
    }
    const base = { type: event.type, sessionId, rootId: wireId(event.rootId), createdAt: new Date().toISOString() };
    let envelope: unknown;
    let kind: "actor" | "snapshot" | "event";
    if (event.type === "@xstate.actor") {
      kind = "actor";
      envelope = {
        ...base,
        name: actor.logic.id ?? actor.id,
        parentId: actor._parent ? wireId(actor._parent.sessionId) : undefined,
        definition: typeof actor.logic.toJSON === "function" ? actor.logic.toJSON() : undefined,
      };
    } else if (event.type === "@xstate.snapshot") {
      kind = "snapshot";
      const snapshot = actor.getSnapshot();
      const context = snapshot?.context;
      envelope = {
        ...base,
        snapshot: {
          status: event.snapshot.status,
          value: snapshot?.value,
          context: actor.id === "document" ? {
            documentId: context?.document?.id ?? null,
            characterCount: context?.document?.content?.length ?? 0,
            blockCount: context?.blocks?.length ?? 0,
            saveError: context?.saveError ? "Storage write failed" : null,
            retryCount: context?.retryCount,
          } : {},
        },
        event: { type: event.event.type },
      };
    } else if (event.type === "@xstate.event") {
      kind = "event";
      envelope = { ...base, event: { type: event.event.type }, sourceId: event.sourceRef ? wireId(event.sourceRef.sessionId) : undefined };
    } else return;
    const serialized = guard.serializeInspection(envelope);
    if (serialized) transport.publish(kind, sessionId, serialized);
  }

  return {
    inspect,
    start() {
      if (!guard.enabled) return;
      active = true;
      transport.start();
    },
    stop() {
      active = false;
      transport.stop();
      queueMicrotask(() => {
        if (active) return;
        actors.clear();
        transport.clear();
      });
    },
  };
}
