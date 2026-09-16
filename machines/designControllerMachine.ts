import { assign, emit, fromPromise, sendParent, setup } from "xstate";
import type {
  ConversationTurn,
  Decision,
  DecisionRequest,
  DesignDecision,
  DesignFact,
  HostActionResult,
  HostContext,
  PendingHostAction,
} from "@/types";
import { cancelDecision, decide, sendReceipt } from "@/lib/design-runtime";
import { describeAction, factFromResult } from "@/lib/design-facts";
import { writeDesignModelPref } from "@/lib/prefs";
import { actorError, doneOutput, errorMessage } from "@/lib/xstate-utils";

export const QUIET_MS = 900;
const KEPT_DECISIONS = 50;

export interface Utterance {
  conversation: ConversationTurn[];
  utterance: string;
  at: number;
}

interface CurrentDecision {
  id: string;
  sessionId: string;
  conversation: ConversationTurn[];
  action: PendingHostAction | null;
}

export interface DesignControllerContext {
  model: string;
  hostContext: HostContext | null;
  pending: Utterance | null;
  current: CurrentDecision | null;
  decisions: DesignDecision[];
}

export type DesignControllerEvents =
  | { type: "app.callStarted" }
  | { type: "app.callEnded" }
  | { type: "app.utterance"; utterance: Utterance; hostContext: HostContext }
  | { type: "app.actionResult"; result: HostActionResult; hostContext: HostContext }
  | { type: "app.prefsLoaded"; model: string }
  | { type: "user.stop" }
  | { type: "user.selectModel"; model: string };

export type DesignControllerParentEvents =
  | { type: "controller.hostAction"; action: PendingHostAction }
  | { type: "controller.fact"; fact: DesignFact };

function patchDecision(
  decisions: DesignDecision[],
  id: string | undefined,
  patch: Partial<DesignDecision>,
): DesignDecision[] {
  return decisions.map((d) => (d.id === id ? { ...d, ...patch } : d));
}

function requireCurrent(context: DesignControllerContext): CurrentDecision {
  if (!context.current) throw new Error("no decision in flight");
  return context.current;
}

export const designControllerMachine = setup({
  types: {
    context: {} as DesignControllerContext,
    events: {} as DesignControllerEvents,
    emitted: {} as { type: "notification"; message: string },
  },
  actors: {
    decider: fromPromise(({ input, signal }: { input: DecisionRequest; signal: AbortSignal }) =>
      decide(input, signal),
    ),
    receipt: fromPromise(
      ({ input, signal }: { input: { sessionId: string; result: HostActionResult }; signal: AbortSignal }) =>
        sendReceipt(input.sessionId, input.result, signal),
    ),
  },
  actions: {
    setModel: assign({
      model: ({ context, event }) =>
        event.type === "user.selectModel" || event.type === "app.prefsLoaded" ? event.model : context.model,
    }),
    persistModel: ({ context }) => writeDesignModelPref(context.model),
    queueUtterance: assign({
      pending: ({ event }) => (event.type === "app.utterance" ? event.utterance : null),
      hostContext: ({ context, event }) =>
        event.type === "app.utterance" ? event.hostContext : context.hostContext,
    }),
    dropPending: assign({ pending: null }),
    beginDecision: assign(({ context }) => {
      const pending = context.pending as Utterance;
      const id = crypto.randomUUID();
      const decision: DesignDecision = {
        id,
        sessionId: `design-${id}`,
        status: "deciding",
        utterance: pending.utterance,
        utteranceAt: pending.at,
        requestedAt: Date.now(),
        returnedAt: null,
        appliedAt: null,
        action: null,
        model: null,
        detail: null,
      };
      return {
        pending: null,
        current: { id, sessionId: decision.sessionId, conversation: pending.conversation, action: null },
        decisions: [...context.decisions, decision].slice(-KEPT_DECISIONS),
      };
    }),
    recordHold: assign({
      decisions: ({ context, event }) =>
        patchDecision(context.decisions, context.current?.id, {
          status: "held",
          returnedAt: Date.now(),
          model: doneOutput<Decision>(event).model,
        }),
      current: null,
    }),
    recordAction: assign(({ context, event }) => {
      const decision = doneOutput<Decision>(event);
      if (decision.kind !== "pending") return {};
      const current = requireCurrent(context);
      return {
        current: { ...current, action: decision.action },
        decisions: patchDecision(context.decisions, current.id, {
          status: "executing",
          returnedAt: Date.now(),
          action: describeAction(decision.action),
          model: decision.model,
        }),
      };
    }),
    recordFailure: assign({
      decisions: ({ context, event }) =>
        patchDecision(context.decisions, context.current?.id, {
          status: "failed",
          returnedAt: Date.now(),
          detail: errorMessage(actorError(event)),
        }),
      current: null,
    }),
    recordCancel: assign({
      decisions: ({ context }) =>
        patchDecision(context.decisions, context.current?.id, {
          status: "cancelled",
          returnedAt: Date.now(),
          detail: "Stopped before the decision returned",
        }),
      current: null,
      pending: null,
    }),
    cancelRuntimeDecision: ({ context }) => {
      if (context.current) void cancelDecision(context.current.sessionId);
    },
    recordResult: assign(({ context, event }) => {
      if (event.type !== "app.actionResult") return {};
      const current = requireCurrent(context);
      const fact = factFromResult(current.action as PendingHostAction, event.result);
      return {
        hostContext: event.hostContext,
        decisions: patchDecision(context.decisions, current.id, {
          status: event.result.outcome === "success" ? "applied" : "failed",
          appliedAt: Date.now(),
          detail: fact.render,
        }),
      };
    }),
    recordReceiptFailure: assign({
      decisions: ({ context, event }) =>
        patchDecision(context.decisions, context.current?.id, {
          detail: `Receipt not recorded: ${errorMessage(actorError(event))}`,
        }),
    }),
    finishDecision: assign({ current: null }),
    announceAction: sendParent(({ context }) => ({
      type: "controller.hostAction" as const,
      action: requireCurrent(context).action as PendingHostAction,
    })),
    announceFact: sendParent(({ context, event }) => {
      if (event.type !== "app.actionResult") throw new Error("announceFact: wrong event");
      return {
        type: "controller.fact" as const,
        fact: factFromResult(requireCurrent(context).action as PendingHostAction, event.result),
      };
    }),
    warnFailure: emit(({ event }) => ({
      type: "notification" as const,
      message: `Design decision failed: ${errorMessage(actorError(event))}`,
    })),
    warnReceipt: emit({
      type: "notification" as const,
      message: "The document changed, but the runtime did not record the receipt.",
    }),
  },
  guards: {
    isHold: ({ event }) => doneOutput<Decision>(event).kind === "hold",
    hasPending: ({ context }) => context.pending !== null,
  },
}).createMachine({
  id: "designController",
  description: [
    "Context:",
    "",
    "- model (string): the design model chosen in the header, `provider:model` or empty for the runtime default; loaded from stored preferences, persisted on change and sent per decision as config.default_model.",
    "- hostContext (HostContext | null): what was on screen at the latest utterance or action result; the decision's view of the document.",
    "- pending (Utterance | null): the latest user utterance not yet decided on, with the conversation through it and when it was heard. Replaced by newer utterances; consumed when a decision starts.",
    "- current (CurrentDecision | null): the decision in flight: its id, its fresh runtime session, the conversation it saw and, once decided, the host action being executed.",
    "- decisions (DesignDecision[]): the last 50 decisions with their timings and outcomes, for the panel and for measuring utterance-to-edit latency.",
  ].join("\n"),
  context: {
    model: "",
    hostContext: null,
    pending: null,
    current: null,
    decisions: [],
  },
  initial: "idle",
  on: {
    "app.prefsLoaded": {
      description: "Stored preferences arrived with the design model chosen last time.",
      actions: "setModel",
    },
    "user.selectModel": {
      description: "The header chose another design model; the next decision uses it. Text and voice are unaffected.",
      actions: ["setModel", "persistModel"],
    },
    "app.callEnded": {
      description: "The live call ended: forget queued speech and abandon a decision in flight (its planning is cancelled at the runtime).",
      target: ".idle",
      actions: ["cancelRuntimeDecision", "recordCancel"],
    },
  },
  states: {
    idle: {
      description: "No live call; nothing to decide on.",
      on: {
        "app.callStarted": {
          description: "A live call connected; listen for utterances.",
          target: "listening",
        },
      },
    },
    listening: {
      description: "Waiting for the person to say something.",
      on: {
        "app.utterance": {
          description: "A new utterance arrived; wait for a short pause in speech before deciding.",
          target: "waiting",
          actions: "queueUtterance",
        },
      },
    },
    waiting: {
      description: "The quiet period after an utterance; more speech restarts it so fragments of one thought become one decision.",
      after: {
        [QUIET_MS]: {
          description: "Speech paused: decide on the queued utterance.",
          target: "deciding",
        },
      },
      on: {
        "app.utterance": {
          description: "More speech: replace the queued utterance and restart the quiet period.",
          target: "waiting",
          reenter: true,
          actions: "queueUtterance",
        },
        "user.stop": {
          description: "The person stopped the controller; the queued utterance is dropped.",
          target: "listening",
          actions: "dropPending",
        },
      },
    },
    deciding: {
      description:
        "One silent decision on a fresh runtime session. Entry consumes the queued utterance into `current` and logs it. Invokes decider (POST /api/chat, output_mode host_tools).",
      entry: "beginDecision",
      invoke: {
        src: "decider",
        input: ({ context }) => {
          const current = requireCurrent(context);
          return {
            sessionId: current.sessionId,
            conversation: current.conversation,
            hostContext: context.hostContext as HostContext,
            model: context.model,
          };
        },
        onDone: [
          {
            description: "The controller held: nothing in the document changes.",
            guard: "isHold",
            target: "settling",
            actions: "recordHold",
          },
          {
            description: "The controller chose one host action. Actions:\n- recordAction: keep it in `current` and the log\n- announceAction: hand it to the app (controller.hostAction) for the document machine",
            target: "executing",
            actions: ["recordAction", "announceAction"],
          },
        ],
        onError: {
          description: "The decision failed (unroutable model, runtime error, timeout): logged and shown; the call continues.",
          target: "settling",
          actions: ["recordFailure", "warnFailure"],
        },
      },
      on: {
        "app.utterance": {
          description: "Speech while deciding is kept for the next decision; the decision in flight is not cancelled.",
          actions: "queueUtterance",
        },
        "user.stop": {
          description: "The person stopped the controller: the runtime is asked to cancel planning, the request is aborted and queued speech is dropped.",
          target: "listening",
          actions: ["cancelRuntimeDecision", "recordCancel"],
        },
      },
    },
    executing: {
      description: "The document machine is performing the action; the result comes back through the app with fresh host context.",
      on: {
        "app.actionResult": {
          description: "The action ran (or could not). Actions:\n- recordResult: log applied/failed with the render outcome and refresh the host context\n- announceFact: tell the app (controller.fact) so Live hears what changed",
          target: "receipting",
          actions: ["recordResult", "announceFact"],
        },
        "app.utterance": {
          description: "Speech during execution is kept for the next decision.",
          actions: "queueUtterance",
        },
        "user.stop": {
          description: "Stop drops queued speech; the local edit in progress still completes and is receipted.",
          actions: "dropPending",
        },
      },
    },
    receipting: {
      description: "Returning the action's result to the decision session so the runtime records it. Invokes receipt.",
      invoke: {
        src: "receipt",
        input: ({ context, event }) => {
          if (event.type !== "app.actionResult") throw new Error("receipting: wrong event");
          return { sessionId: requireCurrent(context).sessionId, result: event.result };
        },
        onDone: {
          description: "Recorded.",
          target: "settling",
          actions: "finishDecision",
        },
        onError: {
          description: "The runtime did not record the receipt; the document change stands and the person is told.",
          target: "settling",
          actions: ["recordReceiptFailure", "warnReceipt", "finishDecision"],
        },
      },
      on: {
        "app.utterance": {
          description: "Speech during the receipt is kept for the next decision.",
          actions: "queueUtterance",
        },
        "user.stop": {
          description: "Stop drops queued speech.",
          actions: "dropPending",
        },
      },
    },
    settling: {
      description: "Transient: decide again on speech that arrived meanwhile, or go back to listening.",
      always: [
        {
          description: "Speech arrived while the last decision ran.",
          guard: "hasPending",
          target: "waiting",
        },
        {
          description: "Nothing queued.",
          target: "listening",
        },
      ],
    },
  },
});
