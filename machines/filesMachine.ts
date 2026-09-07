import { assign, fromPromise, sendParent, setup } from "xstate";
import type { StudioDocument } from "@/types";
import { actorError } from "@/lib/xstate-utils";
import {
  deleteDocument,
  getDocument,
  loadDocuments,
  newDocument,
  putDocument,
  ensureMarkdownName,
  untitledName,
} from "@/lib/files-store";

type Events =
  | { type: "sys.retry" }
  | { type: "user.create" }
  | { type: "user.delete"; id: string }
  | { type: "user.rename"; id: string; name: string }
  | { type: "app.upsert"; document: StudioDocument };

function upsert(documents: StudioDocument[], doc: StudioDocument): StudioDocument[] {
  const rest = documents.filter((d) => d.id !== doc.id);
  return [doc, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const filesMachine = setup({
  types: {
    context: {} as { documents: StudioDocument[]; error: string | null },
    events: {} as Events,
  },
  actors: {
    loader: fromPromise(async () => loadDocuments()),
    creator: fromPromise(async ({ input }: { input: { name: string } }) =>
      putDocument(newDocument(input.name, `# ${input.name.replace(/\.md$/, "")}\n`)),
    ),
    deleter: fromPromise(async ({ input }: { input: { id: string } }) => {
      await deleteDocument(input.id);
      return input.id;
    }),
    renamer: fromPromise(async ({ input }: { input: { id: string; name: string } }) => {
      const doc = await getDocument(input.id);
      if (!doc) throw new Error("no such document");
      return putDocument({
        ...doc,
        name: ensureMarkdownName(input.name),
        updatedAt: new Date().toISOString(),
      });
    }),
  },
  actions: {
    setError: assign({ error: ({ event }) => String(actorError(event)) }),
  },
}).createMachine({
  id: "files",
  description: [
    "Context:",
    "",
    "- documents (StudioDocument[]): every document in IndexedDB, newest first. Filled by loader, kept current by the create/rename/delete actors and app.upsert.",
    "- error (string | null): why the last store operation failed, shown in the sidebar.",
  ].join("\n"),
  context: { documents: [], error: null },
  initial: "loading",
  states: {
    loading: {
      description: "Reading the document list from IndexedDB. Invokes loader.",
      invoke: {
        src: "loader",
        onDone: {
          description: "Documents loaded; the app is told so it can open the requested one.",
          target: "ready",
          actions: [
            assign({ documents: ({ event }) => event.output, error: null }),
            sendParent(({ event }) => ({ type: "files.loaded" as const, documents: event.output })),
          ],
        },
        onError: {
          description: "The store could not be read.",
          target: "ready",
          actions: "setError",
        },
      },
    },
    ready: {
      description: "The list is available and idle.",
      on: {
        "sys.retry": { description: "Read the store again.", target: "loading" },
        "user.create": { description: "The user clicked New.", target: "creating" },
        "user.delete": { description: "The user deleted a document.", target: "deleting" },
        "user.rename": { description: "The user renamed a document from the list.", target: "renaming" },
        "app.upsert": {
          description: "The document machine saved a document; keep the list current.",
          actions: assign({
            documents: ({ context, event }) => upsert(context.documents, event.document),
          }),
        },
      },
    },
    creating: {
      description: "Writing a new untitled document. Invokes creator.",
      invoke: {
        src: "creator",
        input: ({ context }) => ({ name: untitledName(context.documents) }),
        onDone: {
          description: "Created; the app opens it.",
          target: "ready",
          actions: [
            assign({ documents: ({ context, event }) => upsert(context.documents, event.output) }),
            sendParent(({ event }) => ({ type: "files.created" as const, document: event.output })),
          ],
        },
        onError: { description: "The write failed.", target: "ready", actions: "setError" },
      },
    },
    deleting: {
      description: "Removing a document. Invokes deleter.",
      invoke: {
        src: "deleter",
        input: ({ event }) => ({ id: event.type === "user.delete" ? event.id : "" }),
        onDone: {
          description: "Deleted; the app closes it if it was open.",
          target: "ready",
          actions: [
            assign({
              documents: ({ context, event }) => context.documents.filter((d) => d.id !== event.output),
            }),
            sendParent(({ event }) => ({ type: "files.deleted" as const, id: event.output })),
          ],
        },
        onError: { description: "The delete failed.", target: "ready", actions: "setError" },
      },
    },
    renaming: {
      description: "Renaming a document in the store. Invokes renamer.",
      invoke: {
        src: "renamer",
        input: ({ event }) =>
          event.type === "user.rename" ? { id: event.id, name: event.name } : { id: "", name: "" },
        onDone: {
          description: "Renamed; the app syncs the open document's name.",
          target: "ready",
          actions: [
            assign({ documents: ({ context, event }) => upsert(context.documents, event.output) }),
            sendParent(({ event }) => ({ type: "files.renamed" as const, document: event.output })),
          ],
        },
        onError: { description: "The rename failed.", target: "ready", actions: "setError" },
      },
    },
  },
});
