import { assign, fromObservable, fromPromise, sendParent, setup } from "xstate";
import type { ConversationTurn, DesignFact, VoiceView } from "@/types";
import { initialVoiceView } from "@/types";
import { VoiceClient } from "@/lib/voice-client";
import { utteranceConversation } from "@/lib/voice-transcript";
import { actorError, errorMessage } from "@/lib/xstate-utils";
import type { Utterance } from "./designControllerMachine";

export interface VoiceContext {
  client: VoiceClient | null;
  view: VoiceView;
  announced: number;
  error: string | null;
}

export type VoiceEvents =
  | { type: "user.start"; history: ConversationTurn[] }
  | { type: "user.end" }
  | { type: "user.mute" }
  | { type: "user.play" }
  | { type: "app.fact"; fact: DesignFact };

export type VoiceParentEvents =
  | { type: "voice.started" }
  | { type: "voice.utterance"; utterance: Utterance }
  | { type: "voice.ended" };

function requireClient(context: VoiceContext): VoiceClient {
  if (!context.client) throw new Error("no live call");
  return context.client;
}

function snapshotView(event: object, fallback: VoiceView): VoiceView {
  return (event as { snapshot: { context: VoiceView | undefined } }).snapshot.context ?? fallback;
}

export const voiceMachine = setup({
  types: {
    context: {} as VoiceContext,
    events: {} as VoiceEvents,
  },
  actors: {
    observe: fromObservable<VoiceView, VoiceClient>(({ input }) => ({
      subscribe: (observer) => {
        const next = typeof observer === "function" ? observer : (value: VoiceView) => observer.next?.(value);
        const unsubscribe = input.subscribe(next);
        return { unsubscribe };
      },
    })),
    connect: fromPromise(({ input }: { input: VoiceClient }) => input.start()),
    close: fromPromise(({ input }: { input: VoiceClient }) => input.end()),
  },
  actions: {
    createClient: assign({
      client: ({ event }) =>
        event.type === "user.start" ? new VoiceClient(`voice-${crypto.randomUUID()}`, event.history) : null,
      view: () => initialVoiceView(),
      announced: -1,
      error: null,
    }),
    setView: assign({
      view: ({ context, event }) => snapshotView(event, context.view),
    }),
    markAnnounced: assign({
      announced: ({ context, event }) => snapshotView(event, context.view).lastUserFragment,
    }),
    announceUtterance: sendParent(({ context, event }) => {
      const view = snapshotView(event, context.view);
      const heard = utteranceConversation(view.callId, view.fragments);
      if (!heard) throw new Error("announceUtterance: no utterance");
      return {
        type: "voice.utterance" as const,
        utterance: { ...heard, at: Date.now() },
      };
    }),
    announceStarted: sendParent({ type: "voice.started" as const }),
    announceEnded: sendParent({ type: "voice.ended" as const }),
    toggleMic: ({ context }) => requireClient(context).toggleMic(),
    playSound: ({ context }) => requireClient(context).playSound(),
    forwardFact: ({ context, event }) => {
      if (event.type === "app.fact") requireClient(context).sendFact(event.fact);
    },
    setConnectError: assign({
      error: ({ event }) => `Could not start the live call: ${errorMessage(actorError(event))}`,
    }),
    setCloseError: assign({
      error: ({ context, event }) => [context.error, errorMessage(actorError(event))].filter(Boolean).join(" "),
    }),
    setRemoteError: assign({
      error: ({ context }) => context.view.fatal || context.error,
    }),
    releaseClient: assign({ client: null }),
  },
  guards: {
    newUtterance: ({ context, event }) => {
      const view = snapshotView(event, context.view);
      return (
        view.lastUserFragment > context.announced &&
        !view.remoteClosed &&
        utteranceConversation(view.callId, view.fragments) !== null
      );
    },
    sessionEnded: ({ context }) => !!context.view.fatal || context.view.remoteClosed,
  },
}).createMachine({
  id: "voice",
  description: [
    "Context:",
    "",
    "- client (VoiceClient | null): the browser media, WebRTC and runtime transport of the current call; created on user.start, released after close.",
    "- view (VoiceView): what the client last reported: call id, transcript fragments, mute, playback and remote state.",
    "- announced (number): index of the last user fragment already handed to the app as an utterance, so each is announced once.",
    "- error (string | null): why the last call failed to start or to close cleanly; shown until the next call.",
  ].join("\n"),
  context: {
    client: null,
    view: initialVoiceView(),
    announced: -1,
    error: null,
  },
  initial: "idle",
  states: {
    idle: {
      description: "No live call. The panel offers Talk live.",
      on: {
        "user.start": {
          description: "The person clicked Talk live: create a client for a fresh voice session seeded with the text conversation, then connect.",
          target: "call.connecting",
          actions: "createClient",
        },
      },
    },
    call: {
      description: "A call exists from setup to confirmed close. Invokes observe on the client for the whole call; each snapshot updates the view, and a new user utterance is announced to the app.",
      initial: "connecting",
      invoke: {
        src: "observe",
        input: ({ context }) => requireClient(context),
        onSnapshot: [
          {
            description: "The transcript gained a user utterance. Actions:\n- setView: keep the reported view\n- announceUtterance: send voice.utterance with the conversation through it\n- markAnnounced: remember the fragment index",
            guard: "newUtterance",
            actions: ["setView", "announceUtterance", "markAnnounced"],
          },
          {
            description: "Any other change in the reported view.",
            actions: "setView",
          },
        ],
        onError: {
          description: "The client could not be observed; close the call.",
          target: ".closing",
          actions: assign({ error: "Live events could not be observed." }),
        },
      },
      states: {
        connecting: {
          description: "Checking voice status, opening the microphone and negotiating audio with GPT-Live. Invokes connect.",
          on: {
            "user.end": {
              description: "Cancel setup; whatever was allocated is closed.",
              target: "closing",
            },
          },
          invoke: {
            src: "connect",
            input: ({ context }) => requireClient(context),
            onDone: {
              description: "Connected and the provider session started: the app is told (voice.started) so the controller listens.",
              target: "active",
              actions: "announceStarted",
            },
            onError: {
              description: "Setup failed (no key, microphone denied, timeout): close whatever was allocated.",
              target: "closing",
              actions: "setConnectError",
            },
          },
        },
        active: {
          description: "Audio is live; the person and Live talk while the controller draws.",
          always: {
            description: "The provider or transport ended the call.",
            guard: "sessionEnded",
            target: "closing",
            actions: "setRemoteError",
          },
          on: {
            "user.end": {
              description: "Hang up.",
              target: "closing",
            },
            "user.mute": {
              description: "Toggle the microphone track.",
              actions: "toggleMic",
            },
            "user.play": {
              description: "A click to unblock browser audio playback.",
              actions: "playSound",
            },
            "app.fact": {
              description: "The app reports a document change; forwarded to Live as quiet context.",
              actions: "forwardFact",
            },
          },
        },
        closing: {
          description: "Waiting for the runtime to confirm the provider call is closed, then releasing the microphone and audio. Invokes close.",
          invoke: {
            src: "close",
            input: ({ context }) => requireClient(context),
            onDone: {
              description: "Closed and confirmed.",
              target: "#voice.idle",
              actions: ["releaseClient", "announceEnded"],
            },
            onError: {
              description: "Local audio stopped but the close was not confirmed; the error stays visible.",
              target: "#voice.idle",
              actions: ["setCloseError", "releaseClient", "announceEnded"],
            },
          },
        },
      },
    },
  },
});
