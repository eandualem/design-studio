import type { ConversationTurn, MessageRecord, VoiceFragment, VoiceMessage } from "@/types";

/** Fragments of one speaker closer than this are one line of transcript. */
const SAME_TURN_GAP_MS = 1500;

function gapBetween(previousEnd: number | null | undefined, fragment: VoiceFragment): number {
  return fragment.start_ms != null && previousEnd != null ? fragment.start_ms - previousEnd : 0;
}

/**
 * The transcript as shown: consecutive fragments of the same speaker merge
 * into one line. Fragment indexes are append-only for a call, so ids are
 * stable across snapshots.
 */
export function liveMessages(callId: string, fragments: VoiceFragment[]): VoiceMessage[] {
  const messages: VoiceMessage[] = [];
  let previousEnd: number | null | undefined;
  fragments.forEach((fragment, index) => {
    const last = messages[messages.length - 1];
    if (last && last.role === fragment.role && gapBetween(previousEnd, fragment) < SAME_TURN_GAP_MS) {
      last.content += fragment.delta;
    } else {
      messages.push({ id: `voice:${callId}:${index}`, role: fragment.role, content: fragment.delta });
    }
    previousEnd = fragment.end_ms;
  });
  return messages;
}

/**
 * The conversation the controller decides on: everything up to the latest
 * user utterance, where the utterance keeps its identity when Live speaks
 * between two of its fragments (audible gaps separate utterances, assistant
 * text does not). Null when the user has not spoken yet.
 */
export function utteranceConversation(
  callId: string,
  fragments: VoiceFragment[],
): { conversation: ConversationTurn[]; utterance: string } | null {
  const last = fragments.findLastIndex((f) => f.role === "user");
  if (last < 0) return null;
  let first = last;
  let current = last;
  for (let i = last - 1; i >= 0; i--) {
    if (fragments[i].role !== "user") continue;
    const end = fragments[i].end_ms;
    const start = fragments[current].start_ms;
    const same = start != null && end != null ? start - end < SAME_TURN_GAP_MS : i === current - 1;
    if (!same) break;
    first = current = i;
  }
  const utterance = fragments
    .slice(first, last + 1)
    .filter((f) => f.role === "user")
    .map((f) => f.delta)
    .join("")
    .trim();
  if (!utterance) return null;
  const prior = liveMessages(callId, fragments.slice(0, first)).map(({ role, content }) => ({
    role,
    content,
  }));
  return { conversation: [...prior, { role: "user", content: utterance }], utterance };
}

/** The visible text of a chat message, for seeding Live. */
function textOf(message: MessageRecord): string {
  if (message.kind === "user") return message.text;
  return message.segments
    .filter((s): s is Extract<typeof s, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("")
    .trim();
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/**
 * The text conversation as a Live history seed: user/assistant text only,
 * newest first within the runtime's limits (128 entries, 7,000 UTF-8 bytes).
 */
export function seedHistory(messages: MessageRecord[], maxEntries = 128, maxBytes = 7000): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let bytes = 0;
  for (let i = messages.length - 1; i >= 0 && turns.length < maxEntries; i--) {
    const message = messages[i];
    if (message.kind === "user" && message.messageType !== "standard") continue;
    const content = textOf(message);
    if (!content) continue;
    const size = utf8(content);
    if (bytes + size > maxBytes) break;
    bytes += size;
    turns.unshift({ role: message.kind, content });
  }
  return turns;
}

/** Bound a conversation for a decision request, keeping the latest turns whole. */
export function boundConversation(turns: ConversationTurn[], maxBytes = 6000): ConversationTurn[] {
  const kept: ConversationTurn[] = [];
  let bytes = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const size = utf8(turns[i].content);
    if (kept.length > 0 && bytes + size > maxBytes) break;
    bytes += size;
    kept.unshift(turns[i]);
  }
  return kept;
}
