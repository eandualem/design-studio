import {
  DeltaEventSchema,
  ErrorEventSchema,
  FinalResponseEventSchema,
  StatusEventSchema,
  ToolCallEventSchema,
  ToolErrorEventSchema,
  ToolResultEventSchema,
  type AssistantMessageRecord,
  type ContentSegment,
  type MessageRecord,
  type StoredMessage,
  type StoredToolCall,
  type StreamEvent,
  type ToolCallRecord,
  type Usage,
  type UsageTotals,
} from "@/types";

export type ServerEventName =
  | "status"
  | "thinking_delta"
  | "text_delta"
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "final_response"
  | "error";

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object")
        return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Validate a raw Socket.IO payload and translate it into a StreamEvent.
 * Returns null for payloads that do not match the documented shape.
 */
export function translateServerEvent(
  name: ServerEventName,
  payload: unknown,
): StreamEvent | null {
  switch (name) {
    case "status": {
      const r = StatusEventSchema.safeParse(payload);
      return r.success ? { type: "status", status: r.data.status } : null;
    }
    case "thinking_delta": {
      const r = DeltaEventSchema.safeParse(payload);
      return r.success ? { type: "thinking_delta", text: r.data.content } : null;
    }
    case "text_delta": {
      const r = DeltaEventSchema.safeParse(payload);
      return r.success ? { type: "text_delta", text: r.data.content } : null;
    }
    case "tool_call": {
      const r = ToolCallEventSchema.safeParse(payload);
      if (!r.success) return null;
      return {
        type: "tool_call",
        id: r.data.call_id,
        name: r.data.tool_name,
        category: r.data.category === "host" ? "host" : "backend",
        input: parseArguments(r.data.arguments),
      };
    }
    case "tool_result": {
      const r = ToolResultEventSchema.safeParse(payload);
      if (!r.success) return null;
      return {
        type: "tool_result",
        id: r.data.call_id,
        output: r.data.output,
        duration_ms: r.data.duration_ms ?? undefined,
      };
    }
    case "tool_error": {
      const r = ToolErrorEventSchema.safeParse(payload);
      if (!r.success) return null;
      return { type: "tool_error", id: r.data.call_id, error: r.data.error };
    }
    case "final_response": {
      const r = FinalResponseEventSchema.safeParse(payload);
      if (!r.success) return null;
      const d = r.data;
      return {
        type: "final_response",
        messageId: d.message_id ?? null,
        model: d.model ?? null,
        usage: d.usage ?? null,
        error: d.error
          ? { errorType: d.error_type ?? "error", message: null }
          : null,
        pendingToolCall: d.pending_tool_call
          ? {
              callId: d.pending_tool_call.call_id,
              toolName: d.pending_tool_call.tool_name,
              arguments: parseArguments(d.pending_tool_call.arguments),
              queued: d.pending_tool_call.queued ?? [],
            }
          : null,
      };
    }
    case "error": {
      const r = ErrorEventSchema.safeParse(payload);
      if (!r.success) return null;
      return {
        type: "error",
        message: r.data.message,
        errorType: r.data.error_type ?? null,
        terminal: r.data.terminal ?? false,
        retryAllowed: r.data.retry_allowed ?? true,
      };
    }
  }
}

function updateTool(
  segments: ContentSegment[],
  id: string,
  patch: Partial<ToolCallRecord>,
): ContentSegment[] {
  return segments.map((seg) =>
    seg.kind === "tool_group"
      ? {
          ...seg,
          group: {
            tools: seg.group.tools.map((t) =>
              t.id === id ? { ...t, ...patch } : t,
            ),
          },
        }
      : seg,
  );
}

/**
 * Fold one stream event into the assistant message being streamed. Pure:
 * returns a new record. Consecutive tool calls share a tool group; any text
 * or thinking in between starts a new group.
 */
export function foldStreamEvent(
  current: AssistantMessageRecord,
  event: StreamEvent,
): AssistantMessageRecord {
  const segments = [...current.segments];
  const last = segments.length > 0 ? segments[segments.length - 1] : null;

  switch (event.type) {
    case "status":
      return current;

    case "thinking_delta": {
      if (last && last.kind === "thinking") {
        segments[segments.length - 1] = {
          ...last,
          block: { text: last.block.text + event.text },
        };
      } else {
        segments.push({
          id: crypto.randomUUID(),
          kind: "thinking",
          block: { text: event.text },
        });
      }
      return { ...current, segments };
    }

    case "text_delta": {
      if (last && last.kind === "text") {
        segments[segments.length - 1] = {
          ...last,
          text: last.text + event.text,
        };
      } else {
        segments.push({ id: crypto.randomUUID(), kind: "text", text: event.text });
      }
      return { ...current, segments };
    }

    case "tool_call": {
      const tool: ToolCallRecord = {
        id: event.id,
        name: event.name,
        category: event.category,
        input: event.input,
        status: "running",
      };
      const existing = segments
        .flatMap((s) => (s.kind === "tool_group" ? s.group.tools : []))
        .find((t) => t.id === tool.id);
      if (existing && existing.status !== "running") {
        return current;
      }
      if (last && last.kind === "tool_group") {
        const idx = last.group.tools.findIndex((t) => t.id === tool.id);
        const tools =
          idx >= 0
            ? last.group.tools.map((t, i) => (i === idx ? tool : t))
            : [...last.group.tools, tool];
        segments[segments.length - 1] = { ...last, group: { tools } };
      } else {
        segments.push({
          id: crypto.randomUUID(),
          kind: "tool_group",
          group: { tools: [tool] },
        });
      }
      return { ...current, segments };
    }

    case "tool_result":
      return {
        ...current,
        segments: updateTool(segments, event.id, {
          output: event.output,
          status: "completed",
          duration_ms: event.duration_ms,
        }),
      };

    case "tool_error":
      return {
        ...current,
        segments: updateTool(segments, event.id, {
          output: event.error,
          status: "error",
        }),
      };

    case "final_response":
      return {
        ...current,
        id: event.messageId ?? current.id,
        model: event.model ?? current.model,
        usage: event.usage ?? current.usage,
        error: event.error ?? current.error,
      };

    case "error":
      return {
        ...current,
        isStreaming: false,
        error: {
          errorType: event.errorType ?? current.error?.errorType ?? "error",
          message: event.message,
          retryAllowed: event.retryAllowed,
        },
      };
  }
}

/** Mark the pending host tool as answered, with the host's result. */
export function completeHostTool(
  current: AssistantMessageRecord,
  callId: string,
  result: unknown,
  outcome: "success" | "failed",
): AssistantMessageRecord {
  return {
    ...current,
    isStreaming: true,
    segments: updateTool(current.segments, callId, {
      output: result,
      status: outcome === "success" ? "completed" : "error",
    }),
  };
}

/** End of stream without a pending action: tools still running never finish. */
export function finishStreaming(
  current: AssistantMessageRecord,
): AssistantMessageRecord {
  return {
    ...current,
    isStreaming: false,
    segments: current.segments.map((seg) =>
      seg.kind === "tool_group"
        ? {
            ...seg,
            group: {
              tools: seg.group.tools.map((t) =>
                t.status === "running"
                  ? { ...t, status: "error" as const, output: "no result" }
                  : t,
              ),
            },
          }
        : seg,
    ),
  };
}

export function createAssistantMessage(
  parentId: string | null,
  id?: string,
): AssistantMessageRecord {
  return {
    kind: "assistant",
    id: id ?? crypto.randomUUID(),
    parentId,
    segments: [],
    isStreaming: true,
    timestamp: new Date().toISOString(),
    model: null,
    usage: null,
    error: null,
  };
}

/**
 * Convert a row of `GET /api/sessions/{id}/messages` into a display record.
 * Stored tool entries carry no category, so host actions are recognised by
 * name; delivered steering rows become user records of type "steering".
 */
export function normalizeStoredMessage(
  m: StoredMessage,
  hostActionNames: ReadonlySet<string>,
): MessageRecord {
  const timestamp = m.timestamp ?? new Date().toISOString();

  if (m.role === "user") {
    return {
      kind: "user",
      id: m.id,
      parentId: m.parent_id,
      text: m.text,
      messageType: m.message_type,
      timestamp,
    };
  }

  if (m.role === "steering") {
    return {
      kind: "user",
      id: m.id,
      parentId: null,
      text: m.text,
      messageType: "steering",
      timestamp,
    };
  }

  const segments: ContentSegment[] = m.segments.map((seg) => {
    switch (seg.kind) {
      case "thinking":
        return {
          id: seg.segment_id ?? crypto.randomUUID(),
          kind: "thinking",
          block: { text: seg.text },
        };
      case "text":
        return {
          id: seg.segment_id ?? crypto.randomUUID(),
          kind: "text",
          text: seg.text,
        };
      case "tool_group":
        return {
          id: seg.segment_id ?? crypto.randomUUID(),
          kind: "tool_group",
          group: {
            tools: seg.tools.map((tc) => ({
              id: tc.id,
              name: tc.name,
              category: hostActionNames.has(tc.name)
                ? ("host" as const)
                : ("backend" as const),
              input: tc.input,
              output: tc.output,
              status: storedToolStatus(tc),
            })),
          },
        };
    }
  });

  return {
    kind: "assistant",
    id: m.id,
    parentId: m.parent_id,
    segments,
    isStreaming: false,
    timestamp,
    model: null,
    usage: m.usage,
    error: null,
  };
}

function storedToolStatus(tc: StoredToolCall): ToolCallRecord["status"] {
  if (tc.outcome !== undefined && tc.outcome !== "success") return "error";
  if (tc.status !== undefined) return "error";
  return "completed";
}

export const EMPTY_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: null,
  turns: 0,
};

/**
 * Session totals from the messages. Each assistant record holds the latest
 * usage the runtime reported for it (cumulative over its continuations), so
 * summing records never double counts.
 */
export function sumUsage(messages: MessageRecord[]): UsageTotals {
  return messages.reduce((acc, m) => {
    if (m.kind !== "assistant" || !m.usage) return acc;
    const cost = m.usage.cost_usd ?? null;
    return {
      inputTokens: acc.inputTokens + (m.usage.input_tokens ?? 0),
      outputTokens: acc.outputTokens + (m.usage.output_tokens ?? 0),
      costUsd: cost === null ? acc.costUsd : (acc.costUsd ?? 0) + cost,
      turns: acc.turns + 1,
    };
  }, EMPTY_TOTALS);
}

/**
 * Parent for the next user message: the last displayed message the runtime
 * has stored (present in its tree). A placeholder assistant record after a
 * failed turn, or a rejected user message, is skipped; an empty tree means
 * the session has no messages yet.
 */
export function activeLeafId(messages: MessageRecord[], tree: { id: string }[]): string | null {
  const known = new Set(tree.map((n) => n.id));
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === "user" && m.messageType === "steering") continue;
    if (known.has(m.id)) return m.id;
  }
  return null;
}
