import { assign, sendTo, setup, type ActorRefFrom } from "xstate";
import type { Attachment, DesignFact, HostContext, PendingHostAction, StudioDocument, Theme } from "@/types";
import { applyTheme, writeLobbySession, writePanelPref, writeThemePref } from "@/lib/prefs";
import { buildHostContext } from "@/lib/host-context";
import { parseBlocks } from "@/lib/blocks";
import { convertStateToString } from "@/lib/stateToStr";
import { artifactsMachine } from "./artifactsMachine";
import { assistantMachine } from "./assistantMachine";
import { designControllerMachine, type Utterance } from "./designControllerMachine";
import { documentMachine } from "./documentMachine";
import { filesMachine } from "./filesMachine";
import { voiceMachine } from "./voiceMachine";

type Events =
  | { type: "user.togglePanel" }
  | { type: "user.toggleTheme" }
  | { type: "user.openDocument"; id: string }
  | { type: "user.closeDocument" }
  | { type: "sys.screenshot"; dataUri: string | null }
  | { type: "sys.prefsLoaded"; theme: Theme; panelOpen: boolean; lobbySessionId: string; designModel: string }
  | { type: "files.loaded"; documents: StudioDocument[] }
  | { type: "files.created"; document: StudioDocument }
  | { type: "files.deleted"; id: string }
  | { type: "files.renamed"; document: StudioDocument }
  | { type: "document.opened"; document: StudioDocument }
  | { type: "document.saved"; document: StudioDocument }
  | {
      type: "document.actionResult";
      callId: string;
      outcome: "success" | "failed";
      result: unknown;
    }
  | { type: "assistant.hostAction"; action: PendingHostAction }
  | { type: "voice.started" }
  | { type: "voice.utterance"; utterance: Utterance }
  | { type: "voice.ended" }
  | { type: "controller.hostAction"; action: PendingHostAction }
  | { type: "controller.fact"; fact: DesignFact };

interface AppContext {
  filesRef: ActorRefFrom<typeof filesMachine>;
  documentRef: ActorRefFrom<typeof documentMachine>;
  assistantRef: ActorRefFrom<typeof assistantMachine>;
  artifactsRef: ActorRefFrom<typeof artifactsMachine>;
  voiceRef: ActorRefFrom<typeof voiceMachine>;
  designRef: ActorRefFrom<typeof designControllerMachine>;
  theme: Theme;
  openId: string | null;
  requestedId: string | null;
  lobbySessionId: string;
  screenshot: string | null;
}

/** The host context as the machines see it right now (used for continuations and session joins). */
export function gatherHostContext(
  context: AppContext,
  override?: StudioDocument | null,
  extra: Attachment[] = [],
): HostContext {
  const files = context.filesRef.getSnapshot();
  const doc = context.documentRef.getSnapshot();
  const document = override === undefined ? doc.context.document : override;
  const sameDoc = document !== null && doc.context.document?.id === document.id;
  const screenshot: Attachment[] =
    document && context.screenshot
      ? [
          {
            kind: "image",
            purpose: "screenshot",
            name: "preview",
            description: "The rendered preview pane of the open document",
            data_uri: context.screenshot,
          },
        ]
      : [];
  return buildHostContext({
    attachments: [...screenshot, ...extra],
    document,
    blocks: sameDoc ? doc.context.blocks : document ? parseBlocks(document.content) : [],
    renderCache: doc.context.renderCache,
    selection: sameDoc ? doc.context.selection : null,
    documents: files.context.documents,
    filesState: convertStateToString(files.value),
    documentState: override === undefined ? convertStateToString(doc.value) : document ? "open" : "closed",
  });
}

/** The host context a design decision sees: the same as text chat, without the screenshot. */
function decisionContext(context: AppContext): HostContext {
  const { attachments: _attachments, ...rest } = gatherHostContext(context);
  return rest;
}

function documentFromEvent(event: Events, context: AppContext): StudioDocument | null {
  switch (event.type) {
    case "files.created":
    case "document.opened":
      return event.document;
    case "user.openDocument":
      return context.filesRef.getSnapshot().context.documents.find((d) => d.id === event.id) ?? null;
    default:
      return null;
  }
}

export const appMachine = setup({
  types: { context: {} as AppContext, events: {} as Events },
  actors: {
    files: filesMachine,
    document: documentMachine,
    assistant: assistantMachine,
    artifacts: artifactsMachine,
    voice: voiceMachine,
    designController: designControllerMachine,
  },
  actions: {
    setTheme: assign({
      theme: ({ event }) => (event.type === "sys.prefsLoaded" ? event.theme : "dark"),
    }),
    setLobby: assign({
      lobbySessionId: ({ context, event }) =>
        event.type === "sys.prefsLoaded" ? event.lobbySessionId : context.lobbySessionId,
    }),
    flipTheme: assign({ theme: ({ context }) => (context.theme === "dark" ? "light" : "dark") }),
    applyThemeToDocument: ({ context }) => applyTheme(context.theme),
    persistTheme: ({ context }) => writeThemePref(context.theme),
    persistPanel: (_, params: { panelOpen: boolean }) => writePanelPref(params.panelOpen),
    rememberRequest: assign({
      requestedId: ({ event }) => (event.type === "user.openDocument" ? event.id : null),
    }),
    openRequested: assign({ openId: ({ context }) => context.requestedId, requestedId: null }),
    setOpenId: assign({
      openId: ({ context, event }) => documentFromEvent(event, context)?.id ?? context.openId,
    }),
    clearOpenId: assign({ openId: null }),
    showDocument: sendTo(
      ({ context }) => context.documentRef,
      ({ context, event }) => ({
        type: "app.open" as const,
        document: documentFromEvent(event, context) as StudioDocument,
      }),
    ),
    showRequestedDocument: sendTo(
      ({ context }) => context.documentRef,
      ({ context, event }) => {
        if (event.type !== "files.loaded") throw new Error("wrong event");
        const document = event.documents.find((d) => d.id === context.requestedId) as StudioDocument;
        return { type: "app.open" as const, document };
      },
    ),
    hideDocument: sendTo(({ context }) => context.documentRef, { type: "app.close" as const }),
    syncDocument: sendTo(
      ({ context }) => context.documentRef,
      ({ event }) => {
        if (event.type !== "files.renamed") throw new Error("wrong event");
        return { type: "app.sync" as const, document: event.document };
      },
    ),
    attachDocumentSession: sendTo(
      ({ context }) => context.assistantRef,
      ({ context, event }) => {
        const document = documentFromEvent(event, context) as StudioDocument;
        return {
          type: "app.session" as const,
          sessionId: document.sessionId,
          hostContext: gatherHostContext(context, document),
        };
      },
    ),
    attachRequestedSession: sendTo(
      ({ context }) => context.assistantRef,
      ({ context, event }) => {
        if (event.type !== "files.loaded") throw new Error("wrong event");
        const document = event.documents.find((d) => d.id === context.requestedId) as StudioDocument;
        return {
          type: "app.session" as const,
          sessionId: document.sessionId,
          hostContext: gatherHostContext(context, document),
        };
      },
    ),
    attachLobbySession: sendTo(
      ({ context }) => context.assistantRef,
      ({ context }) => ({
        type: "app.session" as const,
        sessionId: context.lobbySessionId,
        hostContext: gatherHostContext(context, null),
      }),
    ),
    rotateLobby: assign({
      lobbySessionId: () => {
        const id = crypto.randomUUID();
        writeLobbySession(id);
        return id;
      },
    }),
    upsertInList: sendTo(
      ({ context }) => context.filesRef,
      ({ event }) => {
        if (event.type !== "document.saved") throw new Error("wrong event");
        return { type: "app.upsert" as const, document: event.document };
      },
    ),
    executeHostAction: sendTo(
      ({ context }) => context.documentRef,
      ({ context, event }) => {
        if (event.type !== "assistant.hostAction") throw new Error("wrong event");
        return {
          type: "app.execute" as const,
          callId: event.action.callId,
          name: event.action.toolName,
          args: event.action.arguments,
          sessionId: context.assistantRef.getSnapshot().context.sessionId ?? "",
        };
      },
    ),
    forwardActionResult: sendTo(
      ({ context }) => context.assistantRef,
      ({ context, event }) => {
        if (event.type !== "document.actionResult") throw new Error("wrong event");
        return {
          type: "host.actionResult" as const,
          callId: event.callId,
          result: event.result,
          outcome: event.outcome,
          hostContext: gatherHostContext(context),
        };
      },
    ),
    executeControllerAction: sendTo(
      ({ context }) => context.documentRef,
      ({ context, event }) => {
        if (event.type !== "controller.hostAction") throw new Error("wrong event");
        return {
          type: "app.execute" as const,
          callId: event.action.callId,
          name: event.action.toolName,
          args: event.action.arguments,
          sessionId: context.assistantRef.getSnapshot().context.sessionId ?? "",
        };
      },
    ),
    forwardControllerResult: sendTo(
      ({ context }) => context.designRef,
      ({ context, event }) => {
        if (event.type !== "document.actionResult") throw new Error("wrong event");
        return {
          type: "app.actionResult" as const,
          result: { callId: event.callId, result: event.result, outcome: event.outcome },
          hostContext: decisionContext(context),
        };
      },
    ),
    setDesignModel: sendTo(
      ({ context }) => context.designRef,
      ({ event }) => {
        if (event.type !== "sys.prefsLoaded") throw new Error("wrong event");
        return { type: "app.prefsLoaded" as const, model: event.designModel };
      },
    ),
    startController: sendTo(({ context }) => context.designRef, { type: "app.callStarted" as const }),
    stopController: sendTo(({ context }) => context.designRef, { type: "app.callEnded" as const }),
    forwardUtterance: sendTo(
      ({ context }) => context.designRef,
      ({ context, event }) => {
        if (event.type !== "voice.utterance") throw new Error("wrong event");
        return { type: "app.utterance" as const, utterance: event.utterance, hostContext: decisionContext(context) };
      },
    ),
    forwardFact: sendTo(
      ({ context }) => context.voiceRef,
      ({ event }) => {
        if (event.type !== "controller.fact") throw new Error("wrong event");
        return { type: "app.fact" as const, fact: event.fact };
      },
    ),
  },
  guards: {
    prefersPanelOpen: ({ event }) => event.type === "sys.prefsLoaded" && event.panelOpen,
    filesReadyWithDocument: ({ context, event }) =>
      context.filesRef.getSnapshot().matches("ready") && documentFromEvent(event, context) !== null,
    hasRequested: ({ context, event }) =>
      event.type === "files.loaded" &&
      context.requestedId !== null &&
      event.documents.some((d) => d.id === context.requestedId),
    sessionChanged: ({ context, event }) => {
      const document = documentFromEvent(event, context);
      return document !== null && document.sessionId !== context.assistantRef.getSnapshot().context.sessionId;
    },
    adoptsLobby: ({ context, event }) =>
      documentFromEvent(event, context)?.sessionId === context.lobbySessionId,
    deletedOpen: ({ context, event }) => event.type === "files.deleted" && event.id === context.openId,
    resultForController: ({ context, event }) =>
      event.type === "document.actionResult" &&
      event.callId === context.designRef.getSnapshot().context.current?.action?.callId,
  },
}).createMachine({
  id: "app",
  description: [
    "Context:",
    "",
    "- filesRef (filesMachine actor): the document list.",
    "- documentRef (documentMachine actor): the open document, its blocks and renders.",
    "- assistantRef (assistantMachine actor): the assistant panel and runtime session.",
    "- artifactsRef (artifactsMachine actor): the prompt artifacts (style guide) view.",
    "- voiceRef (voiceMachine actor): the live voice call with GPT-Live.",
    "- designRef (designControllerMachine actor): the design controller that turns utterances into host actions during a call, and the design model choice.",
    "- theme (Theme): light or dark; applied to <html> and persisted.",
    "- openId (string | null): id of the open document, mirrored to the URL by the routing adapter.",
    "- requestedId (string | null): a document id from the URL that arrived before the list loaded.",
    "- lobbySessionId (string): the runtime session used while no document is open; a document created from it takes it over and a new one is issued.",
    "- screenshot (string | null): the latest JPEG data URI of the preview pane, captured by the screenshot hook; attached as purpose screenshot while a document is open.",
  ].join("\n"),
  context: ({ spawn }) => ({
    filesRef: spawn("files", { id: "files" }),
    documentRef: spawn("document", { id: "document" }),
    assistantRef: spawn("assistant", { id: "assistant" }),
    artifactsRef: spawn("artifacts", { id: "artifacts" }),
    voiceRef: spawn("voice", { id: "voice" }),
    designRef: spawn("designController", { id: "designController" }),
    theme: "dark",
    openId: null,
    requestedId: null,
    lobbySessionId: "",
    screenshot: null,
  }),
  type: "parallel",
  on: {
    "sys.screenshot": {
      description: "The screenshot hook captured the preview pane (or cleared it).",
      actions: assign({ screenshot: ({ event }) => event.dataUri }),
    },
    "user.toggleTheme": {
      description: "Flip light/dark, apply it to the document root and persist.",
      actions: ["flipTheme", "applyThemeToDocument", "persistTheme"],
    },
    "user.openDocument": [
      {
        description: "The user (or the URL) opened a document that is loaded: show it and attach its session.",
        guard: "filesReadyWithDocument",
        actions: ["setOpenId", "showDocument", "attachDocumentSession"],
      },
      {
        description: "The list is not loaded yet; remember the id and open it on files.loaded.",
        actions: "rememberRequest",
      },
    ],
    "user.closeDocument": {
      description: "Back to the file list: close the document and attach the lobby session.",
      actions: ["clearOpenId", "hideDocument", "attachLobbySession"],
    },
    "files.loaded": [
      {
        description: "The list loaded and the URL asked for one of its documents: open it.",
        guard: "hasRequested",
        actions: ["showRequestedDocument", "attachRequestedSession", "openRequested"],
      },
      {
        description: "The list loaded with nothing to open: the assistant uses the lobby session.",
        actions: "attachLobbySession",
      },
    ],
    "files.created": {
      description: "A document was created from the sidebar: open it.",
      actions: ["setOpenId", "showDocument", "attachDocumentSession"],
    },
    "files.deleted": {
      description: "The open document was deleted: close it.",
      guard: "deletedOpen",
      actions: ["clearOpenId", "hideDocument", "attachLobbySession"],
    },
    "files.renamed": {
      description: "A document was renamed from the sidebar; keep the open one in sync.",
      actions: "syncDocument",
    },
    "document.opened": [
      {
        description: "The assistant created or opened a document that took over the lobby conversation: issue a new lobby session.",
        guard: "adoptsLobby",
        actions: ["setOpenId", "rotateLobby"],
      },
      {
        description: "The assistant created or opened a document; the conversation continues in it.",
        actions: "setOpenId",
      },
    ],
    "document.saved": {
      description: "The document machine wrote a document; refresh the list entry.",
      actions: "upsertInList",
    },
    "assistant.hostAction": {
      description: "The runtime is waiting on a host action: hand it to the document machine with the calling session.",
      actions: "executeHostAction",
    },
    "document.actionResult": [
      {
        description: "The document machine finished the design controller's action: hand the result back with fresh host context.",
        guard: "resultForController",
        actions: "forwardControllerResult",
      },
      {
        description: "The document machine finished the assistant's action: send the continuation with fresh host context.",
        actions: "forwardActionResult",
      },
    ],
    "voice.started": {
      description: "A live call connected: the design controller starts listening.",
      actions: "startController",
    },
    "voice.utterance": {
      description: "The person said something on the call: hand it to the controller with what is on screen now.",
      actions: "forwardUtterance",
    },
    "voice.ended": {
      description: "The call ended: the controller stops and drops queued speech.",
      actions: "stopController",
    },
    "controller.hostAction": {
      description: "The design controller decided on a host action: hand it to the document machine with the conversation's session, so a created document keeps the text chat.",
      actions: "executeControllerAction",
    },
    "controller.fact": {
      description: "A controller action ran: Live is told as quiet context.",
      actions: "forwardFact",
    },
  },
  states: {
    panel: {
      description: "Whether the assistant panel is shown.",
      initial: "open",
      states: {
        open: {
          description: "The assistant panel is visible on the right.",
          on: {
            "user.togglePanel": {
              description: "Hide the panel and persist the choice.",
              target: "closed",
              actions: { type: "persistPanel", params: { panelOpen: false } },
            },
            "sys.prefsLoaded": [
              {
                description: "Stored preferences say the panel is open; apply the stored theme, lobby session and design model.",
                guard: "prefersPanelOpen",
                actions: ["setTheme", "setLobby", "setDesignModel", "applyThemeToDocument"],
              },
              {
                description: "Stored preferences say the panel is closed; close it and apply the theme and lobby session.",
                target: "closed",
                actions: ["setTheme", "setLobby", "setDesignModel", "applyThemeToDocument"],
              },
            ],
          },
        },
        closed: {
          description: "The assistant panel is hidden; a toggle in the top bar reopens it.",
          on: {
            "user.togglePanel": {
              description: "Show the panel and persist the choice.",
              target: "open",
              actions: { type: "persistPanel", params: { panelOpen: true } },
            },
            "sys.prefsLoaded": [
              {
                description: "Stored preferences say the panel is open; open it and apply the theme and lobby session.",
                guard: "prefersPanelOpen",
                target: "open",
                actions: ["setTheme", "setLobby", "setDesignModel", "applyThemeToDocument"],
              },
              {
                description: "Stored preferences say the panel is closed; apply the theme and lobby session.",
                actions: ["setTheme", "setLobby", "setDesignModel", "applyThemeToDocument"],
              },
            ],
          },
        },
      },
    },
  },
});
