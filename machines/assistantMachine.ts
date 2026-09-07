import { assign, fromCallback, fromPromise, sendParent, sendTo, setup } from "xstate";
import type {
  AssistantMessageRecord,
  Attachment,
  AttachmentPreview,
  ConnectionStatus,
  HostContext,
  MessageBody,
  MessageRecord,
  PendingHostAction,
  StreamEvent,
  TreeNode,
  UsageTotals,
} from "@/types";
import { truncateTo } from "@/lib/tree";
import { doneOutput } from "@/lib/xstate-utils";
import {
  activeLeafId,
  completeHostTool,
  createAssistantMessage,
  EMPTY_TOTALS,
  finishStreaming,
  foldStreamEvent,
  normalizeStoredMessage,
  sumUsage,
  translateServerEvent,
  type ServerEventName,
} from "@/lib/assistant";
import { CLIENT_EVENTS, createAssistantSocket, SERVER_EVENTS } from "@/lib/assistant-socket";
import {
  fetchSessionDetail,
  fetchSessionMessages,
  fetchSessionTree,
  isNotFound,
  repairSession,
} from "@/lib/runtime-api";
import { HOST_ACTION_NAMES } from "@/lib/host-context";

export type AssistantEvents =
  | { type: "app.session"; sessionId: string; hostContext: HostContext }
  | {
      type: "user.send";
      text: string;
      hostContext: HostContext;
      attachments?: Attachment[];
      previews?: AttachmentPreview[];
      parentId?: string | null;
    }
  | { type: "user.steer"; text: string }
  | { type: "user.selectVariant"; leafId: string }
  | { type: "user.repair" }
  | { type: "user.cancel" }
  | {
      type: "host.actionResult";
      callId: string;
      result: unknown;
      outcome: "success" | "failed";
      hostContext: HostContext;
    }
  | { type: "stream.event"; event: StreamEvent }
  | { type: "stream.done" }
  | { type: "socket.status"; status: ConnectionStatus }
  | { type: "socket.reconnected" };

export type SocketCommand =
  | { type: "socket.join"; sessionId: string; hostContext: HostContext }
  | { type: "socket.send"; body: MessageBody }
  | { type: "socket.cancel"; sessionId: string };

export type AssistantParentEvents = {
  type: "assistant.hostAction";
  action: PendingHostAction;
};

export interface AssistantContext {
  sessionId: string | null;
  messages: MessageRecord[];
  tree: TreeNode[];
  leafId: string | null;
  pendingAction: PendingHostAction | null;
  connection: ConnectionStatus;
  error: string | null;
  totals: UsageTotals;
}

interface History {
  /** null when the requested leaf is unknown to the runtime: keep what is shown. */
  messages: MessageRecord[] | null;
  tree: TreeNode[];
  /** The host action the runtime is still waiting on, from GET /api/sessions/{id}. */
  pending: {
    toolCallId: string;
    toolName: string;
    arguments?: Record<string, unknown> | null;
    queued?: string[];
  } | null;
}

/**
 * The pending action with its arguments: from the session detail when the
 * runtime sends them, else from the stored call in the transcript (older
 * runtimes), else null when it cannot be performed.
 */
export function recoverPendingAction(
  messages: MessageRecord[],
  pending: {
    toolCallId: string;
    toolName: string;
    arguments?: Record<string, unknown> | null;
    queued?: string[];
  },
): PendingHostAction | null {
  const queued = pending.queued ?? [];
  if (pending.arguments && typeof pending.arguments === "object") {
    return { callId: pending.toolCallId, toolName: pending.toolName, arguments: pending.arguments, queued };
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind !== "assistant") continue;
    for (const seg of m.segments) {
      if (seg.kind !== "tool_group") continue;
      const tool = seg.group.tools.find((t) => t.id === pending.toolCallId);
      if (tool) return { callId: tool.id, toolName: pending.toolName, arguments: tool.input, queued };
    }
  }
  return null;
}

function withLastAssistant(
  messages: MessageRecord[],
  update: (m: AssistantMessageRecord) => AssistantMessageRecord,
): MessageRecord[] {
  const last = messages[messages.length - 1];
  if (!last || last.kind !== "assistant") return messages;
  return [...messages.slice(0, -1), update(last)];
}

export const assistantMachine = setup({
  types: {
    context: {} as AssistantContext,
    events: {} as AssistantEvents,
  },
  actors: {
    socket: fromCallback<SocketCommand>(({ sendBack: sendRaw, receive }) => {
        const sendBack = (event: AssistantEvents) => sendRaw(event);
        const socket = createAssistantSocket();
        let joined: { sessionId: string; hostContext: HostContext } | null =
          null;
        let everConnected = false;

        const forward = (name: ServerEventName, payload: unknown) => {
          const event = translateServerEvent(name, payload);
          if (!event) return;
          if (event.type === "status" && event.status === "completed") {
            sendBack({ type: "stream.done" });
            return;
          }
          sendBack({ type: "stream.event", event });
        };

        socket.on(SERVER_EVENTS.status, (p: unknown) => forward("status", p));
        socket.on(SERVER_EVENTS.thinkingDelta, (p: unknown) =>
          forward("thinking_delta", p),
        );
        socket.on(SERVER_EVENTS.textDelta, (p: unknown) =>
          forward("text_delta", p),
        );
        socket.on(SERVER_EVENTS.toolCall, (p: unknown) =>
          forward("tool_call", p),
        );
        socket.on(SERVER_EVENTS.toolResult, (p: unknown) =>
          forward("tool_result", p),
        );
        socket.on(SERVER_EVENTS.toolError, (p: unknown) =>
          forward("tool_error", p),
        );
        socket.on(SERVER_EVENTS.finalResponse, (p: unknown) =>
          forward("final_response", p),
        );
        socket.on(SERVER_EVENTS.error, (p: unknown) => forward("error", p));

        socket.on("connect", () => {
          sendBack({ type: "socket.status", status: "connected" });
          if (joined) {
            socket.emit(CLIENT_EVENTS.join, {
              session_id: joined.sessionId,
              host_context: joined.hostContext,
            });
          }
          if (everConnected) sendBack({ type: "socket.reconnected" });
          everConnected = true;
        });
        socket.on("disconnect", () => {
          sendBack({ type: "socket.status", status: "disconnected" });
        });
        socket.io.on("reconnect_attempt", () => {
          sendBack({ type: "socket.status", status: "connecting" });
        });

        receive((command) => {
          switch (command.type) {
            case "socket.join":
              joined = {
                sessionId: command.sessionId,
                hostContext: command.hostContext,
              };
              if (socket.connected) {
                socket.emit(CLIENT_EVENTS.join, {
                  session_id: command.sessionId,
                  host_context: command.hostContext,
                });
              }
              break;
            case "socket.send":
              socket.emit(CLIENT_EVENTS.message, command.body);
              break;
            case "socket.cancel":
              socket.emit(CLIENT_EVENTS.cancel, {
                session_id: command.sessionId,
              });
              break;
          }
        });

        socket.connect();
        return () => {
          socket.disconnect();
        };
      }),
    historyLoader: fromPromise(
      async ({ input }: { input: { sessionId: string; leafId: string | null } }): Promise<History> => {
        let tree: TreeNode[];
        let pending: History["pending"] = null;
        try {
          const [t, detail] = await Promise.all([
            fetchSessionTree(input.sessionId),
            fetchSessionDetail(input.sessionId),
          ]);
          tree = t;
          if (detail.pending_action) {
            const raw = detail.pending_action.arguments;
            let args: Record<string, unknown> | null = null;
            if (raw && typeof raw === "object") args = raw;
            else if (typeof raw === "string") {
              try {
                args = JSON.parse(raw) as Record<string, unknown>;
              } catch {
                args = null;
              }
            }
            pending = {
              toolCallId: detail.pending_action.tool_call_id,
              toolName: detail.pending_action.tool_name,
              arguments: args,
              queued: detail.pending_action.queued ?? [],
            };
          }
        } catch (error) {
          if (isNotFound(error)) return { messages: [], tree: [], pending: null };
          throw error;
        }
        try {
          const stored = await fetchSessionMessages(input.sessionId, input.leafId);
          return { messages: stored.map((m) => normalizeStoredMessage(m, HOST_ACTION_NAMES)), tree, pending };
        } catch (error) {
          if (isNotFound(error)) return { messages: input.leafId ? null : [], tree, pending };
          throw error;
        }
      },
    ),
    repairer: fromPromise(async ({ input }: { input: { sessionId: string } }) => {
      await repairSession(input.sessionId);
    }),
    treeLoader: fromPromise(async ({ input }: { input: { sessionId: string } }): Promise<TreeNode[]> => {
      try {
        return await fetchSessionTree(input.sessionId);
      } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
      }
    }),
  },
  actions: {
    joinSession: sendTo("socket", ({ event }) => {
      if (event.type !== "app.session") throw new Error("joinSession: wrong event");
      return {
        type: "socket.join" as const,
        sessionId: event.sessionId,
        hostContext: event.hostContext,
      };
    }),
    setSession: assign({
      sessionId: ({ event }) =>
        event.type === "app.session" ? event.sessionId : null,
      messages: [],
      tree: [],
      leafId: null,
      pendingAction: null,
      error: null,
      totals: EMPTY_TOTALS,
    }),
    selectLeaf: assign({
      leafId: ({ event }) => (event.type === "user.selectVariant" ? event.leafId : null),
    }),
    appendUserTurn: assign(({ context, event }) => {
      if (event.type !== "user.send") return {};
      const base =
        event.parentId === undefined ? context.messages : truncateTo(context.messages, event.parentId);
      const parentId =
        event.parentId === undefined ? activeLeafId(context.messages, context.tree) : event.parentId;
      const userId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      return {
        messages: [
          ...base,
          {
            kind: "user" as const,
            id: userId,
            parentId,
            text: event.text,
            messageType: "standard" as const,
            timestamp,
            ...(event.previews && event.previews.length > 0 ? { attachments: event.previews } : {}),
          },
          createAssistantMessage(userId),
        ],
        leafId: null,
        pendingAction: null,
      };
    }),
    sendUserMessage: sendTo("socket", ({ context, event }) => {
      if (event.type !== "user.send") throw new Error("sendUserMessage: wrong event");
      const user = context.messages[context.messages.length - 2];
      const parentId = user?.kind === "user" ? user.parentId : null;
      const body: MessageBody = {
        id: user?.id ?? crypto.randomUUID(),
        session_id: context.sessionId ?? "",
        content: event.text,
        message_type: "standard",
        ...(parentId ? { parent_id: parentId } : {}),
        ...(event.attachments && event.attachments.length > 0
          ? { attachments: event.attachments }
          : {}),
        host_context: event.hostContext,
      };
      return { type: "socket.send" as const, body };
    }),
    appendSteering: assign({
      messages: ({ context, event }) =>
        event.type === "user.steer"
          ? [
              ...context.messages.slice(0, -1),
              {
                kind: "user" as const,
                id: crypto.randomUUID(),
                parentId: null,
                text: event.text,
                messageType: "steering" as const,
                timestamp: new Date().toISOString(),
              },
              ...context.messages.slice(-1),
            ]
          : context.messages,
    }),
    sendSteering: sendTo("socket", ({ context, event }) => {
      if (event.type !== "user.steer") throw new Error("sendSteering: wrong event");
      const body: MessageBody = {
        id: crypto.randomUUID(),
        session_id: context.sessionId ?? "",
        content: event.text,
        message_type: "steering",
      };
      return { type: "socket.send" as const, body };
    }),
    foldEvent: assign({
      messages: ({ context, event }) =>
        event.type === "stream.event"
          ? withLastAssistant(context.messages, (m) =>
              foldStreamEvent(m, event.event),
            )
          : context.messages,
    }),
    capturePendingAction: assign({
      pendingAction: ({ context, event }) =>
        event.type === "stream.event" &&
        event.event.type === "final_response" &&
        event.event.pendingToolCall
          ? event.event.pendingToolCall
          : context.pendingAction,
      totals: ({ context, event }) =>
        event.type === "stream.event" && event.event.type === "final_response"
          ? sumUsage(
              withLastAssistant(context.messages, (m) => foldStreamEvent(m, event.event)),
            )
          : context.totals,
    }),
    finishTurn: assign({
      messages: ({ context }) =>
        withLastAssistant(context.messages, finishStreaming),
      pendingAction: null,
    }),
    pauseForHostAction: assign({
      messages: ({ context }) =>
        withLastAssistant(context.messages, (m) => ({
          ...m,
          isStreaming: false,
        })),
    }),
    announceHostAction: sendParent(({ context }) => ({
      type: "assistant.hostAction" as const,
      action: context.pendingAction as PendingHostAction,
    })),
    recordActionResult: assign({
      messages: ({ context, event }) =>
        event.type === "host.actionResult"
          ? withLastAssistant(context.messages, (m) =>
              completeHostTool(m, event.callId, event.result, event.outcome),
            )
          : context.messages,
      pendingAction: null,
    }),
    sendContinuation: sendTo("socket", ({ context, event }) => {
      if (event.type !== "host.actionResult")
        throw new Error("sendContinuation: wrong event");
      const body: MessageBody = {
        id: crypto.randomUUID(),
        session_id: context.sessionId ?? "",
        content: "",
        message_type: "standard",
        tool_call_id: event.callId,
        tool_result: event.result,
        tool_outcome: event.outcome,
        host_context: event.hostContext,
      };
      return { type: "socket.send" as const, body };
    }),
    requestCancel: sendTo("socket", ({ context }) => ({
      type: "socket.cancel" as const,
      sessionId: context.sessionId ?? "",
    })),
    applyHistory: assign({
      messages: ({ context, event }) => doneOutput<History>(event).messages ?? context.messages,
      tree: ({ event }) => doneOutput<History>(event).tree,
      totals: ({ context, event }) => {
        const output = doneOutput<History>(event);
        return output.messages ? sumUsage(output.messages) : context.totals;
      },
      leafId: null,
      error: ({ event }) =>
        doneOutput<History>(event).messages ? null : "That branch is not stored by the runtime.",
    }),
    setConnection: assign({
      connection: ({ context, event }) =>
        event.type === "socket.status" ? event.status : context.connection,
    }),
  },
  guards: {
    isErrorEvent: ({ event }) =>
      event.type === "stream.event" && event.event.type === "error",
    hasPendingAction: ({ context }) => context.pendingAction !== null,
    historyHasRecoverableAction: ({ event }) => {
      const output = (event as { output?: History }).output;
      return (
        output?.pending != null &&
        output.messages !== null &&
        recoverPendingAction(output.messages, output.pending) !== null
      );
    },
    historyHasUnrecoverableAction: ({ event }) => {
      const output = (event as { output?: History }).output;
      return output?.pending != null;
    },
    hasSession: ({ context }) => context.sessionId !== null,
    sessionDiffers: ({ context, event }) =>
      event.type === "app.session" && event.sessionId !== context.sessionId,
  },
}).createMachine({
  id: "assistant",
  description: [
    "Context:",
    "",
    "- sessionId (string | null): the runtime session of the open document; set by app.session.",
    "- messages (MessageRecord[]): the displayed root-to-leaf path; the last record is the assistant message being streamed while streaming.",
    "- tree (TreeNode[]): the runtime's view of the session (GET /tree), refreshed after every turn; the parent of the next message and the variant switcher come from it.",
    "- leafId (string | null): the leaf whose path to load instead of the session's active leaf, set by user.selectVariant.",
    "- pendingAction (PendingHostAction | null): the host tool call the runtime is waiting on, taken from final_response.pending_tool_call or recovered from GET /api/sessions/{id} + the stored call after a reload; cleared when answered or superseded.",
    "- connection (ConnectionStatus): transport status reported by the socket actor, for the header dot only.",
    "- error (string | null): the last non-turn failure (history load), shown above the message list.",
    "- totals (UsageTotals): tokens and cost summed over every assistant message in this session; a continuation's final_response carries the cumulative usage of its message, so totals are recomputed from the messages, never added.",
  ].join("\n"),
  context: {
    sessionId: null,
    messages: [],
    tree: [],
    leafId: null,
    pendingAction: null,
    connection: "connecting",
    error: null,
    totals: EMPTY_TOTALS,
  },
  invoke: {
    id: "socket",
    src: "socket",
  },
  on: {
    "socket.status": {
      description: "The transport reported a connection change; recorded for display.",
      actions: "setConnection",
    },
    "app.session": {
      description:
        "The app opened a document with another runtime session. Joins the session room with the current host context and reloads its history; the same session again is ignored.",
      guard: "sessionDiffers",
      target: ".loadingHistory",
      actions: ["setSession", "joinSession"],
    },
  },
  initial: "idle",
  states: {
    idle: {
      description: "No session yet, or the session is quiet and ready for a message.",
      on: {
        "user.send": {
          description:
            "The user sent a message (optionally branching from parentId with attachments). Appends the user turn and an empty assistant record, then emits the message body with parent_id, attachments and host context.",
          guard: "hasSession",
          target: "streaming",
          actions: ["appendUserTurn", "sendUserMessage"],
        },
        "user.selectVariant": {
          description: "The user picked another branch; load the path to that leaf.",
          guard: "hasSession",
          target: "loadingHistory",
          actions: "selectLeaf",
        },
      },
    },
    loadingHistory: {
      description:
        "Reading the session's root-to-leaf path from the runtime. Invokes historyLoader; a 404 means a fresh session.",
      invoke: {
        src: "historyLoader",
        input: ({ context }) => ({ sessionId: context.sessionId ?? "", leafId: context.leafId }),
        onDone: [
          {
            description:
              "The runtime is still waiting on a host action whose arguments are in the stored transcript (a reload mid-action): perform it now.",
            guard: "historyHasRecoverableAction",
            target: "awaitingHostAction",
            actions: [
              "applyHistory",
              assign({
                pendingAction: ({ event }) =>
                  recoverPendingAction(event.output.messages ?? [], event.output.pending as NonNullable<History["pending"]>),
              }),
            ],
          },
          {
            description:
              "The runtime is waiting on a host action this app cannot reconstruct: offer to repair the session.",
            guard: "historyHasUnrecoverableAction",
            target: "needsRepair",
            actions: "applyHistory",
          },
          {
            description:
              "History and tree loaded; totals are recomputed from stored usage. An unknown leaf keeps the current transcript and says so.",
            target: "idle",
            actions: "applyHistory",
          },
        ],
        onError: {
          description: "The runtime could not be read; the panel shows the error and stays usable.",
          target: "idle",
          actions: assign({
            error: ({ event }) =>
              `Could not load the conversation: ${String(event.error)}`,
          }),
        },
      },
    },
    streaming: {
      description:
        "A turn is live: stream events fold into the last assistant message until status completed.",
      initial: "live",
      on: {
        "stream.event": [
          {
            description:
              "A terminal assistant:error ended the turn. Folded into the message; the tree is refreshed from the runtime.",
            guard: "isErrorEvent",
            target: "syncingTree",
            actions: "foldEvent",
          },
          {
            description:
              "A stream event. Actions:\n- foldEvent: append or extend the matching segment\n- capturePendingAction: remember final_response.pending_tool_call and add usage to the totals",
            actions: ["foldEvent", "capturePendingAction"],
          },
        ],
        "stream.done": [
          {
            description:
              "status completed with a pending host action: the app must perform it before the model resumes.",
            guard: "hasPendingAction",
            target: "awaitingHostAction",
            actions: "pauseForHostAction",
          },
          {
            description: "status completed: the turn is over; the tree is refreshed from the runtime.",
            target: "syncingTree",
            actions: "finishTurn",
          },
        ],
        "socket.reconnected": {
          description:
            "The transport reconnected mid-turn. Missed events are not replayed, so the history is reloaded.",
          target: "loadingHistory",
        },
      },
      states: {
        live: {
          description: "Events are arriving.",
          on: {
            "user.steer": {
              description: "A mid-turn nudge: sent as message_type steering and shown in the transcript; the turn continues.",
              actions: ["appendSteering", "sendSteering"],
            },
            "user.cancel": {
              description: "The user asked to stop. Sends assistant_cancel and waits for the runtime's cancelled outcome.",
              target: "cancelling",
              actions: "requestCancel",
            },
          },
        },
        cancelling: {
          description:
            "Cancellation requested; the runtime answers with final_response(cancelled), a terminal error and status completed.",
        },
      },
    },
    needsRepair: {
      description:
        "The session has a pending host action this app cannot answer (its call is not in the transcript). The user can repair the session; the runtime resolves the call as unknown.",
      on: {
        "user.repair": {
          description: "POST /api/sessions/{id}/repair, then reload.",
          target: "repairing",
        },
      },
    },
    repairing: {
      description: "Repairing the session. Invokes repairer.",
      invoke: {
        src: "repairer",
        input: ({ context }) => ({ sessionId: context.sessionId ?? "" }),
        onDone: { description: "Repaired; reload history.", target: "loadingHistory" },
        onError: {
          description: "The repair failed; stay and show why.",
          target: "needsRepair",
          actions: assign({
            error: ({ event }) => `Repair failed: ${String(event.error)}`,
          }),
        },
      },
    },
    syncingTree: {
      description:
        "A turn just ended: re-read GET /tree so the next parent_id and the variant switcher reflect what the runtime stored. Invokes treeLoader.",
      invoke: {
        src: "treeLoader",
        input: ({ context }) => ({ sessionId: context.sessionId ?? "" }),
        onDone: {
          description: "Tree refreshed.",
          target: "idle",
          actions: assign({ tree: ({ event }) => event.output }),
        },
        onError: {
          description: "The tree could not be read; the previous tree stays.",
          target: "idle",
        },
      },
    },
    awaitingHostAction: {
      description:
        "The runtime is waiting for the host to perform pendingAction. Entry tells the app (assistant.hostAction) so the document machine executes it.",
      entry: "announceHostAction",
      on: {
        "host.actionResult": {
          description:
            "The app performed (or could not perform) the action. Actions:\n- recordActionResult: mark the tool card with the result\n- sendContinuation: emit the continuation body with tool_call_id, tool_result, tool_outcome and fresh host context",
          target: "streaming",
          actions: ["recordActionResult", "sendContinuation"],
        },
        "user.send": {
          description:
            "The user sent a new message instead of answering; the runtime supersedes the pending action.",
          target: "streaming",
          actions: ["appendUserTurn", "sendUserMessage"],
        },
        "socket.reconnected": {
          description: "The transport reconnected; the history is reloaded.",
          target: "loadingHistory",
        },
      },
    },
  },
});
