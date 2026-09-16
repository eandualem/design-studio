import { z } from "zod";

// Voice contract (runtime docs/voice.md, conversation-only calls). Wire shapes
// come from the runtime; the view is what the client reports to the machine.

export const VoiceStatusSchema = z
  .object({
    enabled: z.boolean(),
    configured: z.boolean(),
    conversation_mode_supported: z.boolean().optional(),
    call_instructions_supported: z.boolean().optional(),
    active_calls: z.number().optional(),
  })
  .passthrough();
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const VoiceOfferSchema = z
  .object({
    call_id: z.string().min(1),
    session_id: z.string(),
    mode: z.literal("conversation"),
    transport: z.object({ type: z.literal("webrtc"), sdp: z.string().min(1) }),
  })
  .passthrough();
export type VoiceOffer = z.infer<typeof VoiceOfferSchema>;

export const VoiceFragmentSchema = z.object({
  role: z.enum(["user", "assistant"]),
  delta: z.string(),
  start_ms: z.number().nullable().optional(),
  end_ms: z.number().nullable().optional(),
});
export type VoiceFragment = z.infer<typeof VoiceFragmentSchema>;

export const VoiceEventSchema = z.object({
  type: z.literal("voice"),
  call_id: z.string(),
  event: z.string(),
  data: z.record(z.unknown()),
});
export type VoiceEvent = z.infer<typeof VoiceEventSchema>;

export const VoiceCloseSchema = z
  .object({ finalized: z.boolean().optional() })
  .passthrough();

/** One line of the live transcript: consecutive fragments of one speaker merged. */
export interface VoiceMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** A conversation seed for Live and the controller: user/assistant text only. */
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * A quiet application fact for Live (`session.thinking.append`): what the
 * design controller did, so Live can mention a change only once it happened.
 */
export interface DesignFact {
  action: string;
  status: "applied" | "failed";
  block: string | null;
  summary: string | null;
  render: string | null;
}

/** What the voice client reports; the machine reads it through onSnapshot. */
export interface VoiceView {
  callId: string;
  /** Transcript fragments as delivered by the runtime, in order. */
  fragments: VoiceFragment[];
  /** Index of the latest user fragment, so the machine sees each new utterance once. */
  lastUserFragment: number;
  micMuted: boolean;
  soundBlocked: boolean;
  remoteClosed: boolean;
  finalized: boolean;
  warning: string;
  fatal: string;
}

export const initialVoiceView = (): VoiceView => ({
  callId: "",
  fragments: [],
  lastUserFragment: -1,
  micMuted: false,
  soundBlocked: false,
  remoteClosed: false,
  finalized: false,
  warning: "",
  fatal: "",
});
