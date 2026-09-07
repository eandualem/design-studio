import { z } from "zod";
import { AttachmentSchema, HostContextSchema } from "./host";

// ── Server → client stream events (runtime docs/api.md) ─────────────

export const UsageSchema = z
  .object({
    input_tokens: z.number().nullish(),
    output_tokens: z.number().nullish(),
    total_tokens: z.number().nullish(),
    requests: z.number().nullish(),
    tool_calls: z.number().nullish(),
    cost_usd: z.number().nullish(),
    auxiliary: z.record(z.unknown()).nullish(),
  })
  .passthrough();
export type Usage = z.infer<typeof UsageSchema>;

const SegmentMetaSchema = z.object({
  segment_id: z.string().optional(),
  segment_index: z.number().optional(),
  delta_index: z.number().optional(),
  segment_started: z.boolean().optional(),
  segment_kind: z.enum(["text", "thinking"]).optional(),
});

export const StatusEventSchema = z
  .object({ status: z.enum(["started", "completed"]) })
  .passthrough();

export const DeltaEventSchema = SegmentMetaSchema.extend({
  content: z.string(),
}).passthrough();

export const ToolCallEventSchema = z
  .object({
    tool_name: z.string(),
    arguments: z.union([z.record(z.unknown()), z.string(), z.null()]).optional(),
    call_id: z.string(),
    category: z.enum(["backend", "host"]).optional(),
  })
  .passthrough();

export const ToolResultEventSchema = z
  .object({
    tool_name: z.string().optional(),
    output: z.unknown(),
    call_id: z.string(),
    duration_ms: z.number().nullish(),
    invalidates: z.array(z.string()).nullish(),
  })
  .passthrough();

export const ToolErrorEventSchema = z
  .object({
    tool_name: z.string().optional(),
    error: z.string(),
    call_id: z.string(),
  })
  .passthrough();

export const PendingToolCallSchema = z.object({
  tool_name: z.string(),
  call_id: z.string(),
  arguments: z.union([z.record(z.unknown()), z.string(), z.null()]).optional(),
  /** Call ids of further host actions from the same response, handed over one at a time. */
  queued: z.array(z.string()).optional(),
});

export const FinalResponseEventSchema = z
  .object({
    content: z.string().nullish(),
    model: z.string().nullish(),
    streamed: z.boolean().optional(),
    session_id: z.string().nullish(),
    message_id: z.string().nullish(),
    trace_id: z.string().nullish(),
    usage: UsageSchema.nullish(),
    error: z.boolean().optional(),
    error_type: z.string().nullish(),
    pending_tool_call: PendingToolCallSchema.nullish(),
  })
  .passthrough();

export const ErrorEventSchema = z
  .object({
    type: z.string().optional(),
    message: z.string(),
    error_type: z.string().nullish(),
    terminal: z.boolean().optional(),
    retry_allowed: z.boolean().optional(),
    trace_id: z.string().nullish(),
  })
  .passthrough();

/** One stream event after translation into the app's vocabulary. */
export type StreamEvent =
  | { type: "status"; status: "started" | "completed" }
  | { type: "thinking_delta"; text: string }
  | { type: "text_delta"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      category: ToolCategory;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      id: string;
      output: unknown;
      duration_ms?: number;
    }
  | { type: "tool_error"; id: string; error: string }
  | {
      type: "final_response";
      messageId: string | null;
      model: string | null;
      usage: Usage | null;
      error: { errorType: string; message: string | null } | null;
      pendingToolCall: {
        callId: string;
        toolName: string;
        arguments: Record<string, unknown>;
        queued: string[];
      } | null;
    }
  | {
      type: "error";
      message: string;
      errorType: string | null;
      terminal: boolean;
      retryAllowed: boolean;
    };

// ── Client → server payloads ────────────────────────────────────────

export const MessageTypeSchema = z.enum(["standard", "steering"]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const MessageBodySchema = z.object({
  id: z.string(),
  session_id: z.string(),
  content: z.string(),
  parent_id: z.string().optional(),
  message_type: MessageTypeSchema.optional(),
  attachments: z.array(AttachmentSchema).optional(),
  host_context: HostContextSchema.optional(),
  config: z.record(z.unknown()).optional(),
  tool_call_id: z.string().optional(),
  tool_result: z.unknown().optional(),
  tool_outcome: z.enum(["success", "failed"]).optional(),
});
export type MessageBody = z.infer<typeof MessageBodySchema>;

export const JoinSessionBodySchema = z.object({
  session_id: z.string(),
  host_context: HostContextSchema.optional(),
});
export type JoinSessionBody = z.infer<typeof JoinSessionBodySchema>;

export const CancelBodySchema = z.object({ session_id: z.string() });
export type CancelBody = z.infer<typeof CancelBodySchema>;

// ── HTTP shapes (runtime docs/api.md, sessions) ─────────────────────

export const SessionSummarySchema = z
  .object({
    session_id: z.string(),
    owner_id: z.string().nullish(),
    title: z.string().nullish(),
    turn_number: z.number().nullish(),
    message_count: z.number().nullish(),
    created_at: z.string().nullish(),
  })
  .passthrough();
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const PendingActionSchema = z
  .object({
    tool_call_id: z.string(),
    tool_name: z.string(),
    assistant_message_id: z.string().nullish(),
    arguments: z.union([z.record(z.unknown()), z.string(), z.null()]).optional(),
    queued: z.array(z.string()).optional(),
  })
  .passthrough();

export const SessionDetailSchema = z
  .object({
    session_id: z.string(),
    turn_number: z.number().nullish(),
    message_count: z.number().nullish(),
    has_pending_tool_call: z.boolean().optional(),
    pending_action: PendingActionSchema.nullish(),
  })
  .passthrough();
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

/**
 * Stored tool entry inside a tool_group segment. `output` is absent when no
 * result was recorded; `outcome` is present only when it is not "success";
 * `status` says how a non-successful call was resolved. No category is
 * stored: the host classifies host vs backend tools by name.
 */
export const StoredToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()).default({}),
  output: z.unknown().optional(),
  outcome: z.enum(["success", "failed", "interrupted"]).optional(),
  status: z.enum(["failed", "cancelled", "superseded", "unknown"]).optional(),
});
export type StoredToolCall = z.infer<typeof StoredToolCallSchema>;

const StoredSegmentMeta = {
  segment_id: z.string().optional(),
  segment_index: z.number().optional(),
};

export const StoredSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thinking"), text: z.string(), ...StoredSegmentMeta }),
  z.object({ kind: z.literal("text"), text: z.string(), ...StoredSegmentMeta }),
  z.object({
    kind: z.literal("tool_group"),
    tools: z.array(StoredToolCallSchema),
    ...StoredSegmentMeta,
  }),
]);
export type StoredSegment = z.infer<typeof StoredSegmentSchema>;

/** One row of `GET /api/sessions/{id}/messages` (the display path). */
export const StoredMessageSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("user"),
    id: z.string(),
    parent_id: z.string().nullable(),
    text: z.string(),
    message_type: MessageTypeSchema,
    timestamp: z.string().nullable(),
  }),
  z.object({
    role: z.literal("assistant"),
    id: z.string(),
    parent_id: z.string().nullable(),
    text: z.string(),
    segments: z.array(StoredSegmentSchema),
    usage: UsageSchema.nullable(),
    timestamp: z.string().nullable(),
  }),
  z.object({
    role: z.literal("steering"),
    id: z.string(),
    text: z.string(),
    message_type: z.literal("steering"),
    status: z.enum(["delivered", "promoted"]),
    timestamp: z.string().nullable(),
  }),
]);
export type StoredMessage = z.infer<typeof StoredMessageSchema>;

export const StoredMessagesSchema = z.array(StoredMessageSchema);

/** One row of `GET /api/sessions/{id}/tree`: every message with its parent. */
export const TreeNodeSchema = z
  .object({
    id: z.string(),
    parent_id: z.string().nullable(),
    role: z.string(),
    message_type: z.string().nullish(),
    content: z.string().nullish(),
    created_at: z.string().nullish(),
  })
  .passthrough();
export type TreeNode = z.infer<typeof TreeNodeSchema>;
export const TreeSchema = z.array(TreeNodeSchema);

// ── Display records (what the panel renders) ────────────────────────

export type ToolCategory = "host" | "backend";

export interface ToolCallRecord {
  id: string;
  name: string;
  category: ToolCategory;
  input: Record<string, unknown>;
  output?: unknown;
  status: "running" | "completed" | "error";
  duration_ms?: number;
}

export interface ThinkingBlock {
  text: string;
}

export interface ToolGroup {
  tools: ToolCallRecord[];
}

export type ContentSegment =
  | { id: string; kind: "thinking"; block: ThinkingBlock }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "tool_group"; group: ToolGroup };

export interface MessageError {
  errorType: string;
  message: string | null;
  retryAllowed?: boolean;
}

/** A reference image the user attached, kept for display in the transcript of this session only. */
export interface AttachmentPreview {
  name: string;
  dataUri: string;
}

export interface UserMessageRecord {
  kind: "user";
  id: string;
  parentId: string | null;
  text: string;
  messageType: MessageType;
  timestamp: string;
  attachments?: AttachmentPreview[];
}

/** Sibling variants of a user message on the displayed path. */
export interface VariantInfo {
  /** 1-based position of the displayed message among its siblings. */
  index: number;
  count: number;
  /** For each sibling, the leaf to load to display that branch. */
  leafIds: string[];
}

export interface AssistantMessageRecord {
  kind: "assistant";
  id: string;
  parentId: string | null;
  segments: ContentSegment[];
  isStreaming: boolean;
  timestamp: string;
  model: string | null;
  usage: Usage | null;
  error: MessageError | null;
}

export type MessageRecord = UserMessageRecord | AssistantMessageRecord;

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** Running totals for the session header. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  turns: number;
}
