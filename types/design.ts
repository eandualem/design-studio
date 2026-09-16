import { z } from "zod";
import { PendingToolCallSchema } from "./assistant";
import type { ConversationTurn } from "./voice";
import type { HostContext, PendingHostAction } from "./host";

// The design controller: one silent decision per utterance through
// `POST /api/chat` with `output_mode: "host_tools"` (runtime
// docs/host-contract.md, "Silent host decisions").

export const DecisionResponseSchema = z
  .object({
    content: z.string().nullish(),
    decision: z.enum(["hold", "pending", "completed"]).nullish(),
    pending_tool_call: PendingToolCallSchema.nullish(),
    model: z.string().nullish(),
    error: z.string().nullish(),
  })
  .passthrough();
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

/** What the decider returns to the machine. */
export type Decision =
  | { kind: "hold"; model: string | null }
  | { kind: "pending"; action: PendingHostAction; model: string | null };

/** The input of one decision: the conversation so far and what is on screen. */
export interface DecisionRequest {
  sessionId: string;
  conversation: ConversationTurn[];
  hostContext: HostContext;
  /** `provider:model`, or empty for the runtime default. */
  model: string;
}

export type DecisionStatus =
  | "deciding"
  | "held"
  | "executing"
  | "applied"
  | "failed"
  | "cancelled";

/** One controller decision, kept for the panel and for timing. */
export interface DesignDecision {
  id: string;
  sessionId: string;
  status: DecisionStatus;
  /** The utterance the decision answers (its last line). */
  utterance: string;
  /** Wall-clock ms: when the utterance was heard, sent, answered and applied. */
  utteranceAt: number;
  requestedAt: number;
  returnedAt: number | null;
  appliedAt: number | null;
  /** Host action name and block id, once decided. */
  action: string | null;
  model: string | null;
  detail: string | null;
}

/** A model the header offers for design decisions. */
export interface DesignModelOption {
  /** `provider:model`; empty means the runtime default. */
  id: string;
  label: string;
  note: string;
}
