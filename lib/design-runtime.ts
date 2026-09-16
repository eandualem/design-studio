import {
  DecisionResponseSchema,
  PendingHostActionSchema,
  type ConversationTurn,
  type Decision,
  type DecisionRequest,
  type HostActionResult,
} from "@/types";
import instructions from "@/profiles/design-controller.md?raw";
import { designModelConfig } from "./design-model";
import { RUNTIME_URL } from "./runtime-url";
import { boundConversation } from "./voice-transcript";

/** How long one decision may take before the app gives up on it. */
const DECISION_TIMEOUT_MS = 60_000;

async function postChat(body: unknown, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`${RUNTIME_URL}/api/chat`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(DECISION_TIMEOUT_MS)]),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json as { error?: unknown; detail?: unknown } | null) ?? {};
    const message = [detail.error, detail.detail].find((v) => typeof v === "string" && v);
    throw new Error(message ? String(message) : `/api/chat: HTTP ${res.status}`);
  }
  return json;
}

function renderConversation(turns: ConversationTurn[]): string {
  return turns.map((t) => `${t.role === "user" ? "User" : "Live"}: ${t.content}`).join("\n");
}

/**
 * One silent decision on a fresh session: the controller instructions and the
 * conversation through the latest utterance are the message; the host context
 * carries the document and the six actions. Tool calls only come back.
 */
export async function decide(request: DecisionRequest, signal: AbortSignal): Promise<Decision> {
  const body = {
    id: crypto.randomUUID(),
    session_id: request.sessionId,
    output_mode: "host_tools",
    content: `${instructions}\n\n## Conversation\n\n${renderConversation(boundConversation(request.conversation))}`,
    host_context: request.hostContext,
    ...designModelConfig(request.model),
  };
  const result = DecisionResponseSchema.parse(await postChat(body, signal));
  if (result.error) throw new Error(result.error);
  const model = result.model ?? null;
  if (result.decision === "hold") return { kind: "hold", model };
  if (result.decision === "pending" && result.pending_tool_call) {
    const call = result.pending_tool_call;
    const raw = call.arguments;
    let args: Record<string, unknown> = {};
    if (raw && typeof raw === "object") args = raw;
    else if (typeof raw === "string") args = JSON.parse(raw) as Record<string, unknown>;
    const action = PendingHostActionSchema.parse({
      callId: call.call_id,
      toolName: call.tool_name,
      arguments: args,
      queued: call.queued ?? [],
    });
    return { kind: "pending", action, model };
  }
  throw new Error("The runtime did not return a design decision.");
}

/**
 * The receipt for an executed action, on the decision's own session. The
 * runtime records it and answers `decision: "completed"` without a model call.
 */
export async function sendReceipt(
  sessionId: string,
  result: HostActionResult,
  signal: AbortSignal,
): Promise<void> {
  const response = DecisionResponseSchema.parse(
    await postChat(
      {
        id: crypto.randomUUID(),
        session_id: sessionId,
        content: "",
        output_mode: "host_tools",
        tool_call_id: result.callId,
        tool_result: result.result,
        tool_outcome: result.outcome,
      },
      signal,
    ),
  );
  if (response.decision !== "completed" || response.pending_tool_call || response.content?.trim())
    throw new Error("The design receipt did not complete silently.");
}

/** Ask the runtime to stop a decision that is still planning. Best effort. */
export async function cancelDecision(sessionId: string): Promise<void> {
  await fetch(`${RUNTIME_URL}/api/chat/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    headers: { Accept: "application/json" },
  }).catch(() => undefined);
}
