import { assign, fromPromise, sendParent, setup, stateIn } from "xstate";
import { MAX_SAVE_RETRIES, type Block, type StudioDocument } from "@/types";
import { parseBlocks } from "@/lib/blocks";
import { actorError, doneOutput } from "@/lib/xstate-utils";
import {
  applyEditAction,
  describeBlocks,
  editResult,
  isEditAction,
  missingRenders,
  parseAction,
  reportForDocument,
  type ParsedAction,
  type RenderCache,
} from "@/lib/document-actions";
import {
  ensureMarkdownName,
  getDocument,
  loadDocuments,
  newDocument,
  putDocument,
} from "@/lib/files-store";
import { renderDiagram } from "@/lib/mermaid";

export interface PendingDocumentAction {
  callId: string;
  sessionId: string;
  parsed: ParsedAction;
  resultBlockId: string | null;
}

export interface DocumentContext {
  document: StudioDocument | null;
  blocks: Block[];
  renderCache: RenderCache;
  selection: string | null;
  pending: PendingDocumentAction | null;
  saveError: string | null;
  retryCount: number;
}

export type DocumentEvents =
  | { type: "app.open"; document: StudioDocument }
  | { type: "app.close" }
  | { type: "app.sync"; document: StudioDocument }
  | {
      type: "app.execute";
      callId: string;
      name: string;
      args: Record<string, unknown>;
      sessionId: string;
    }
  | { type: "user.edit"; content: string }
  | { type: "user.retrySave" }
  | { type: "user.select"; blockId: string | null }
  | { type: "user.rename"; name: string };

export type DocumentParentEvents =
  | { type: "document.opened"; document: StudioDocument }
  | { type: "document.saved"; document: StudioDocument }
  | {
      type: "document.actionResult";
      callId: string;
      outcome: "success" | "failed";
      result: unknown;
    };

const SAVE_DEBOUNCE_MS = 500;

function withContent(doc: StudioDocument, content: string): StudioDocument {
  return { ...doc, content, updatedAt: new Date().toISOString() };
}

function requirePending(context: DocumentContext): PendingDocumentAction {
  if (!context.pending) throw new Error("no pending action");
  return context.pending;
}

function pendingResult(context: DocumentContext): unknown {
  const pending = requirePending(context);
  if (!pending.parsed.ok) return { error: pending.parsed.error };
  const { action } = pending.parsed;
  const blocks = describeBlocks(context.blocks, context.renderCache);
  switch (action.name) {
    case "create_document":
      return {
        document_id: context.document?.id,
        blocks,
        render: reportForDocument(context.blocks, context.renderCache),
      };
    case "open_document":
      return { document_id: context.document?.id, blocks };
    case "rename_document":
      return { applied: true };
    default:
      return editResult(action, context.blocks, context.renderCache, pending.resultBlockId);
  }
}

export const documentMachine = setup({
  types: {
    context: {} as DocumentContext,
    events: {} as DocumentEvents,
  },
  delays: { saveRetry: 1500 },
  actors: {
    renderer: fromPromise(async ({ input }: { input: { codes: string[] } }) => {
      const cache: RenderCache = {};
      for (const code of input.codes) cache[code] = await renderDiagram(code);
      return cache;
    }),
    saver: fromPromise(async ({ input }: { input: { document: StudioDocument } }) =>
      putDocument(input.document),
    ),
    creator: fromPromise(
      async ({ input }: { input: { name: string; content: string; sessionId: string } }) =>
        putDocument({ ...newDocument(input.name, input.content), sessionId: input.sessionId }),
    ),
    finder: fromPromise(
      async ({
        input,
      }: {
        input: { documentId?: string; name?: string; sessionId: string };
      }): Promise<StudioDocument | null> => {
        const docs = await loadDocuments();
        const wanted = input.name ? ensureMarkdownName(input.name) : null;
        const found =
          docs.find((d) => d.id === input.documentId) ??
          docs.find((d) => d.name === wanted || d.name === input.name) ??
          null;
        if (!found) return null;
        return putDocument({ ...found, sessionId: input.sessionId });
      },
    ),
    renamer: fromPromise(
      async ({
        input,
      }: {
        input: { documentId: string; name: string };
      }): Promise<StudioDocument | null> => {
        const doc = await getDocument(input.documentId);
        if (!doc) return null;
        return putDocument({
          ...doc,
          name: ensureMarkdownName(input.name),
          updatedAt: new Date().toISOString(),
        });
      },
    ),
  },
  actions: {
    openDocument: assign({
      document: ({ event }) => (event.type === "app.open" ? event.document : null),
      blocks: ({ event }) => (event.type === "app.open" ? parseBlocks(event.document.content) : []),
      selection: null,
      saveError: null,
      retryCount: 0,
    }),
    closeDocument: assign({ document: null, blocks: [], selection: null, pending: null, saveError: null, retryCount: 0 }),
    syncDocument: assign({
      document: ({ context, event }) =>
        event.type === "app.sync" && context.document?.id === event.document.id
          ? { ...context.document, name: event.document.name }
          : context.document,
    }),
    setPending: assign({
      pending: ({ event }) => {
        if (event.type !== "app.execute") return null;
        return {
          callId: event.callId,
          sessionId: event.sessionId,
          parsed: parseAction(event.name, event.args),
          resultBlockId: null,
        };
      },
    }),
    clearPending: assign({ pending: null }),
    editContent: assign({
      document: ({ context, event }) =>
        event.type === "user.edit" && context.document
          ? withContent(context.document, event.content)
          : context.document,
      blocks: ({ context, event }) =>
        event.type === "user.edit" ? parseBlocks(event.content) : context.blocks,
    }),
    select: assign({
      selection: ({ event }) => (event.type === "user.select" ? event.blockId : null),
    }),
    renameOpen: assign({
      document: ({ context, event }) =>
        event.type === "user.rename" && context.document
          ? { ...context.document, name: ensureMarkdownName(event.name), updatedAt: new Date().toISOString() }
          : context.document,
    }),
    renameOpenFromPending: assign({
      document: ({ context }) => {
        const pending = requirePending(context);
        if (!pending.parsed.ok || pending.parsed.action.name !== "rename_document" || !context.document)
          return context.document;
        return {
          ...context.document,
          name: ensureMarkdownName(pending.parsed.action.args.name),
          updatedAt: new Date().toISOString(),
        };
      },
    }),
    applyPendingEdit: assign(({ context }) => {
      const pending = requirePending(context);
      if (!pending.parsed.ok || !isEditAction(pending.parsed.action) || !context.document)
        return {};
      const applied = applyEditAction(context.document.content, pending.parsed.action);
      if (!applied.ok) return {};
      return {
        document: withContent(context.document, applied.edit.content),
        blocks: applied.edit.blocks,
        pending: { ...pending, resultBlockId: applied.edit.resultBlockId },
        selection: applied.edit.resultBlockId,
      };
    }),
    adoptDocument: assign({
      document: ({ event }) => doneOutput<StudioDocument>(event),
      blocks: ({ event }) => parseBlocks(doneOutput<StudioDocument>(event).content),
      selection: null,
      saveError: null,
      retryCount: 0,
    }),
    mergeRenders: assign({
      renderCache: ({ context, event }) => ({
        ...context.renderCache,
        ...doneOutput<RenderCache>(event),
      }),
    }),
    markRenderFailure: assign({
      renderCache: ({ context, event }) => {
        const message = `renderer failed: ${String(actorError(event))}`;
        const cache = { ...context.renderCache };
        for (const code of missingRenders(context.blocks, context.renderCache)) {
          cache[code] = { ok: false, error: message };
        }
        return cache;
      },
    }),
    setSaveError: assign({
      saveError: ({ event }) => {
        const error = actorError(event);
        return error === null || error === undefined
          ? "Could not save to this browser. Check available storage and retry."
          : `Could not save: ${String(error)}`;
      },
    }),
    clearSaveError: assign({ saveError: null }),
    resetRetries: assign({ retryCount: 0 }),
    incrementRetries: assign({ retryCount: ({ context }) => context.retryCount + 1 }),
    replySaveFailed: sendParent(({ context }) => ({
      type: "document.actionResult" as const,
      callId: requirePending(context).callId,
      outcome: "failed" as const,
      result: { error: context.saveError },
    })),
    reportOpened: sendParent(({ context }) => ({
      type: "document.opened" as const,
      document: context.document as StudioDocument,
    })),
    reportSaved: sendParent(({ event }) => ({
      type: "document.saved" as const,
      document: doneOutput<StudioDocument>(event),
    })),
    replyPendingSuccess: sendParent(({ context }) => ({
      type: "document.actionResult" as const,
      callId: requirePending(context).callId,
      outcome: "success" as const,
      result: pendingResult(context),
    })),
    replyPendingInvalid: sendParent(({ context }) => ({
      type: "document.actionResult" as const,
      callId: requirePending(context).callId,
      outcome: "failed" as const,
      result: pendingResult(context),
    })),
    replyNoDocument: sendParent(({ context }) => ({
      type: "document.actionResult" as const,
      callId: requirePending(context).callId,
      outcome: "failed" as const,
      result: { error: "no document is open" },
    })),
    replyEditFailed: sendParent(({ context }) => {
      const pending = requirePending(context);
      const error =
        pending.parsed.ok && isEditAction(pending.parsed.action) && context.document
          ? (() => {
              const r = applyEditAction(context.document.content, pending.parsed.action);
              return r.ok ? "edit could not be applied" : r.error;
            })()
          : "edit could not be applied";
      return {
        type: "document.actionResult" as const,
        callId: pending.callId,
        outcome: "failed" as const,
        result: { error },
      };
    }),
    replyNotFound: sendParent(({ context }) => ({
      type: "document.actionResult" as const,
      callId: requirePending(context).callId,
      outcome: "failed" as const,
      result: { error: "no such document" },
    })),
    replyActorError: sendParent(({ context, event }) => ({
      type: "document.actionResult" as const,
      callId: requirePending(context).callId,
      outcome: "failed" as const,
      result: { error: String(actorError(event)) },
    })),
  },
  guards: {
    hasSaveError: ({ context }) => context.saveError !== null,
    saveHasNewerDraft: stateIn({ open: { saving: "changed" } }),
    retriesExhausted: ({ context }) => context.retryCount >= MAX_SAVE_RETRIES,
    retriesExhaustedWithPending: ({ context }) => context.retryCount >= MAX_SAVE_RETRIES && context.pending !== null,
    hasDocument: ({ context }) => context.document !== null,
    hasPending: ({ context }) => context.pending !== null,
    pendingInvalid: ({ context }) => context.pending !== null && !context.pending.parsed.ok,
    pendingIs: ({ context }, params: { name: string }) =>
      context.pending?.parsed.ok === true && context.pending.parsed.action.name === params.name,
    pendingRenamesOpen: ({ context }) =>
      context.pending?.parsed.ok === true &&
      context.pending.parsed.action.name === "rename_document" &&
      context.document?.id === context.pending.parsed.action.args.document_id,
    editApplies: ({ context }) => {
      const pending = context.pending;
      if (!pending || !pending.parsed.ok || !isEditAction(pending.parsed.action) || !context.document)
        return false;
      return applyEditAction(context.document.content, pending.parsed.action).ok;
    },
    found: ({ event }) => doneOutput<unknown>(event) !== null,
  },
}).createMachine({
  id: "document",
  description: [
    "Context:",
    "",
    "- document (StudioDocument | null): the open document, kept current as the user or the assistant edits it.",
    "- blocks (Block[]): the parsed blocks of document.content; index-based ids regenerated on every parse.",
    "- renderCache (Record<string, RenderResult>): Mermaid render results keyed by diagram source, so unchanged diagrams are not rendered again.",
    "- selection (string | null): the selected block id, reported in the host context.",
    "- pending (PendingDocumentAction | null): the host action being executed: call id, the session it belongs to, the parsed action and the block its result names.",
    "- saveError (string | null): why the last save to IndexedDB failed.",
    "- retryCount (number): automatic retries started for this draft; resets on success, new edits, document changes or manual retry.",
  ].join("\n"),
  context: {
    document: null,
    blocks: [],
    renderCache: {},
    selection: null,
    pending: null,
    saveError: null,
    retryCount: 0,
  },
  initial: "closed",
  on: {
    "app.execute": {
      description: "The assistant called a host action. Records it and decides how to run it.",
      target: ".applying",
      actions: "setPending",
    },
  },
  states: {
    closed: {
      description: "No document is open; the centre pane shows the file list state.",
      on: {
        "app.open": {
          description: "The app opens a document.",
          target: "open",
          actions: "openDocument",
        },
      },
    },
    applying: {
      description:
        "Transient: routes the pending host action.\n- invalid arguments: reply failed\n- create_document / open_document / rename_document: their own states\n- block edits: apply, then save and render\n- an edit without an open document: reply failed",
      always: [
        {
          description: "Arguments did not validate against the declared schema.",
          guard: "pendingInvalid",
          target: "resuming",
          actions: ["replyPendingInvalid", "clearPending"],
        },
        {
          description: "create_document: write a new document that adopts the calling session.",
          guard: { type: "pendingIs", params: { name: "create_document" } },
          target: "creating",
        },
        {
          description: "open_document: find it by id or name.",
          guard: { type: "pendingIs", params: { name: "open_document" } },
          target: "finding",
        },
        {
          description: ["Rename the open document, save, then reply.", "", "Actions:", "- renameOpenFromPending: apply the requested name", "- resetRetries: start a fresh save budget"].join("\n"),
          guard: "pendingRenamesOpen",
          target: "open.saving",
          actions: ["renameOpenFromPending", "resetRetries"],
        },
        {
          description: "rename_document on another document: update it in the store.",
          guard: { type: "pendingIs", params: { name: "rename_document" } },
          target: "renaming",
        },
        {
          description: ["Apply the block edit, then save and render.", "", "Actions:", "- applyPendingEdit: update content, blocks and selection", "- resetRetries: start a fresh save budget"].join("\n"),
          guard: "editApplies",
          target: "open.saving",
          actions: ["applyPendingEdit", "resetRetries"],
        },
        {
          description: "A block edit that references an unknown block.",
          guard: "hasDocument",
          target: "open.saving",
          actions: ["replyEditFailed", "clearPending"],
        },
        {
          description: "A block edit with no document open.",
          target: "closed",
          actions: ["replyNoDocument", "clearPending"],
        },
      ],
    },
    resuming: {
      description: "Transient: return to the open document, or to closed.",
      always: [
        { description: "A document is open.", guard: "hasDocument", target: "open.saving" },
        { description: "Nothing is open.", target: "closed" },
      ],
    },
    creating: {
      description: "Writing the new document to IndexedDB. Invokes creator.",
      invoke: {
        src: "creator",
        input: ({ context }) => {
          const pending = requirePending(context);
          if (!pending.parsed.ok || pending.parsed.action.name !== "create_document")
            throw new Error("creating: wrong pending action");
          return { ...pending.parsed.action.args, sessionId: pending.sessionId };
        },
        onDone: {
          description: "Created: open it, tell the app, then render and reply.",
          target: "open.rendering",
          actions: ["adoptDocument", "reportSaved", "reportOpened"],
        },
        onError: {
          description: "The store refused the write; the assistant is told.",
          target: "resuming",
          actions: ["replyActorError", "clearPending"],
        },
      },
    },
    finding: {
      description: "Looking the document up by id or name and moving the conversation to it. Invokes finder.",
      invoke: {
        src: "finder",
        input: ({ context }) => {
          const pending = requirePending(context);
          if (!pending.parsed.ok || pending.parsed.action.name !== "open_document")
            throw new Error("finding: wrong pending action");
          return {
            documentId: pending.parsed.action.args.document_id,
            name: pending.parsed.action.args.name,
            sessionId: pending.sessionId,
          };
        },
        onDone: [
          {
            description: "Found: open it, tell the app, then render and reply.",
            guard: "found",
            target: "open.rendering",
            actions: ["adoptDocument", "reportSaved", "reportOpened"],
          },
          {
            description: "No document matches.",
            target: "resuming",
            actions: ["replyNotFound", "clearPending"],
          },
        ],
        onError: {
          description: "The store could not be read.",
          target: "resuming",
          actions: ["replyActorError", "clearPending"],
        },
      },
    },
    renaming: {
      description: "Renaming a document that is not the open one. Invokes renamer.",
      invoke: {
        src: "renamer",
        input: ({ context }) => {
          const pending = requirePending(context);
          if (!pending.parsed.ok || pending.parsed.action.name !== "rename_document")
            throw new Error("renaming: wrong pending action");
          return {
            documentId: pending.parsed.action.args.document_id,
            name: pending.parsed.action.args.name,
          };
        },
        onDone: [
          {
            description: "Renamed: tell the app and reply.",
            guard: "found",
            target: "resuming",
            actions: ["reportSaved", "replyPendingSuccess", "clearPending"],
          },
          {
            description: "No document with that id.",
            target: "resuming",
            actions: ["replyNotFound", "clearPending"],
          },
        ],
        onError: {
          description: "The store could not be written.",
          target: "resuming",
          actions: ["replyActorError", "clearPending"],
        },
      },
    },
    open: {
      description: "A document is open. Substates save and render; the pending host action is answered once rendering is done.",
      initial: "rendering",
      on: {
        "app.open": {
          description: "The app switches to another document.",
          target: "open",
          reenter: true,
          actions: "openDocument",
        },
        "app.close": {
          description: "The app closed the document (deleted, or back to the list).",
          target: "closed",
          actions: "closeDocument",
        },
        "app.sync": {
          description: "The document was renamed from the sidebar; keep the name current.",
          actions: "syncDocument",
        },
        "user.edit": {
          description: ["Schedule a save after typing pauses.", "", "Actions:", "- editContent: update the draft and reparse blocks", "- resetRetries: give the new draft a fresh retry budget"].join("\n"),
          target: ".dirty",
          actions: ["editContent", "resetRetries"],
        },
        "user.select": {
          description: "The user selected a block in the preview.",
          actions: "select",
        },
        "user.rename": {
          description: ["Save the user's new document name.", "", "Actions:", "- renameOpen: update the name", "- resetRetries: start a fresh save budget"].join("\n"),
          target: ".saving",
          actions: ["renameOpen", "resetRetries"],
        },
      },
      states: {
        rendering: {
          description: "Rendering the diagrams whose source is not cached. Invokes renderer.",
          invoke: {
            src: "renderer",
            input: ({ context }) => ({ codes: missingRenders(context.blocks, context.renderCache) }),
            onDone: [
              {
                description: "The draft rendered but storage failed; begin bounded save recovery without declaring success.",
                guard: "hasSaveError",
                target: "saveFailed",
                actions: "mergeRenders",
              },
              {
                description: "Rendered; a pending host action gets its result now.",
                guard: "hasPending",
                target: "ready",
                actions: ["mergeRenders", "replyPendingSuccess", "clearPending"],
              },
              {
                description: "Rendered.",
                target: "ready",
                actions: "mergeRenders",
              },
            ],
            onError: [
              {
                description: "Record the renderer failure while the unsaved draft enters save recovery.",
                guard: "hasSaveError",
                target: "saveFailed",
                actions: "markRenderFailure",
              },
              {
                description: "Mermaid itself failed; the affected diagrams are marked and the action still replies.",
                guard: "hasPending",
                target: "ready",
                actions: ["markRenderFailure", "replyPendingSuccess", "clearPending"],
              },
              {
                description: "Mermaid itself failed; the affected diagrams are marked.",
                target: "ready",
                actions: "markRenderFailure",
              },
            ],
          },
        },
        saving: {
          description: "One IndexedDB write is in flight.\n- current: no newer draft\n- changed: keep edits in memory until this write settles, then save the latest draft",
          initial: "current",
          states: {
            current: { description: "The in-flight write contains the current draft." },
            changed: { description: "The user edited during the write; its completion cannot mark the newer draft saved." },
          },
          on: {
            "user.edit": {
              description: ["Keep the new draft while the existing write finishes.", "", "Actions:", "- editContent: retain and reparse the latest draft", "- resetRetries: give the new draft a fresh retry budget"].join("\n"),
              target: ".changed",
              actions: ["editContent", "resetRetries"],
            },
            "user.rename": {
              description: ["Keep the new name while the existing write finishes.", "", "Actions:", "- renameOpen: update the draft name", "- resetRetries: give the new draft a fresh retry budget"].join("\n"),
              target: ".changed",
              actions: ["renameOpen", "resetRetries"],
            },
          },
          invoke: {
            src: "saver",
            input: ({ context }) => ({ document: context.document as StudioDocument }),
            onDone: [
              {
                description: "An older draft committed; report that write and immediately save the newest draft in a new invocation.",
                guard: "saveHasNewerDraft",
                target: "saving",
                reenter: true,
                actions: "reportSaved",
              },
              {
                description: ["The current draft committed; render it.", "", "Actions:", "- clearSaveError: clear the error only after storage succeeds", "- resetRetries: reset the automatic retry budget", "- reportSaved: notify the app of the persisted document"].join("\n"),
                target: "rendering",
                actions: ["clearSaveError", "resetRetries", "reportSaved"],
              },
            ],
            onError: [
              {
                description: "An older write failed; preserve the error and debounce the new draft without overlapping writes.",
                guard: "saveHasNewerDraft",
                target: "dirty",
                actions: "setSaveError",
              },
              {
                description: "The current write failed; retain the draft and error, render, then enter bounded recovery.",
                target: "rendering",
                actions: "setSaveError",
              },
            ],
          },
        },
        saveFailed: {
          description: "The rendered draft is still unsaved. Two automatic retries precede a manual fallback.",
          initial: "retrying",
          states: {
            retrying: {
              description: "Wait briefly before another save, unless the automatic retry budget is exhausted.",
              always: [
                {
                  description: ["Storage retries exhausted during a host action; show the manual fallback.", "", "Actions:", "- replySaveFailed: report the persistence failure once", "- clearPending: finish the host action"].join("\n"),
                  guard: "retriesExhaustedWithPending",
                  target: "failed",
                  actions: ["replySaveFailed", "clearPending"],
                },
                {
                  description: "Automatic retries exhausted; keep the draft for manual recovery.",
                  guard: "retriesExhausted",
                  target: "failed",
                },
              ],
              after: {
                saveRetry: {
                  description: "Start the next bounded retry of the current draft.",
                  target: "#document.open.saving",
                  actions: "incrementRetries",
                },
              },
            },
            failed: {
              description: "Automatic saves stopped. Keep the draft in this tab and let the user retry after fixing storage.",
              on: {
                "user.retrySave": {
                  description: "The user retries the current draft with a fresh automatic retry budget.",
                  target: "#document.open.saving",
                  actions: "resetRetries",
                },
              },
            },
          },
        },
        ready: {
          description: "Saved and rendered.",
        },
        dirty: {
          description: "Unsaved user edits; saves after a short pause in typing.",
          after: {
            [SAVE_DEBOUNCE_MS]: {
              description: "Typing paused.",
              target: "saving",
            },
          },
        },
      },
    },
  },
});
