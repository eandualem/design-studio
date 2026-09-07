import { io, type Socket } from "socket.io-client";
import { RUNTIME_URL } from "./runtime-url";

/**
 * Socket.IO connection to the runtime's `/assistant` namespace. Reconnection
 * is the transport's job; the machine only learns about definitive outcomes.
 */
export function createAssistantSocket(): Socket {
  return io(`${RUNTIME_URL}/assistant`, {
    autoConnect: false,
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}

/**
 * Client → server event names. docs/api.md lists the colon form
 * (`assistant:message`); the running runtime (develop a8b8d3e) only answers
 * the underscore form. Reported to the runtime's agent; switch here when the
 * canonical side is decided.
 */
export const CLIENT_EVENTS = {
  join: "assistant_join_session",
  message: "assistant_message",
  cancel: "assistant_cancel",
} as const;

/** Server → client event names, as documented and observed. */
export const SERVER_EVENTS = {
  status: "assistant:status",
  thinkingDelta: "assistant:thinking_delta",
  textDelta: "assistant:text_delta",
  toolCall: "assistant:tool_call",
  toolResult: "assistant:tool_result",
  toolError: "assistant:tool_error",
  finalResponse: "assistant:final_response",
  error: "assistant:error",
} as const;
