import type {
  Attachment,
  Block,
  DocumentMeta,
  HostAction,
  HostContext,
  StudioDocument,
} from "@/types";
import { describeBlocks, type RenderCache } from "./document-actions";

export const APP_VERSION = "0.1.0";

/** The host actions the studio performs when the assistant calls them. */
export const HOST_ACTIONS: HostAction[] = [
  {
    name: "create_document",
    description:
      "Create a new Markdown design document and open it. Diagrams are fenced ```mermaid blocks.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name ending in .md" },
        content: { type: "string", description: "Full Markdown content" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "open_document",
    description: "Open an existing document by id or name.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "replace_block",
    description:
      "Replace one block of the open document. The result reports the Mermaid render outcome of the new content.",
    parameters: {
      type: "object",
      properties: {
        block_id: { type: "string" },
        content: { type: "string", description: "Replacement Markdown for the block" },
      },
      required: ["block_id", "content"],
    },
  },
  {
    name: "insert_block",
    description:
      'Insert a block after the given block id, or at the top with "start".',
    parameters: {
      type: "object",
      properties: {
        after_block_id: { type: "string" },
        content: { type: "string" },
      },
      required: ["after_block_id", "content"],
    },
  },
  {
    name: "delete_block",
    description: "Delete one block of the open document.",
    parameters: {
      type: "object",
      properties: { block_id: { type: "string" } },
      required: ["block_id"],
    },
  },
  {
    name: "rename_document",
    description: "Rename a document.",
    parameters: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        name: { type: "string" },
      },
      required: ["document_id", "name"],
    },
  },
];

export const HOST_ACTION_NAMES: ReadonlySet<string> = new Set(
  HOST_ACTIONS.map((a) => a.name),
);

export interface HostContextInput {
  document: StudioDocument | null;
  blocks: Block[];
  renderCache: RenderCache;
  selection: string | null;
  documents: DocumentMeta[];
  filesState: string;
  documentState: string;
  attachments?: Attachment[];
}

/**
 * Build the host_context v1 snapshot for a message (brief: "Host contract
 * mapping"). Pure; the caller gathers machine snapshots.
 */
export function buildHostContext(input: HostContextInput): HostContext {
  const navigation = [
    { name: "files", description: "The document list" },
    ...(input.document
      ? [
          {
            name: "document",
            description: "The open document",
            route: `/d/${input.document.id}`,
          },
        ]
      : []),
  ];

  const view = input.document
    ? {
        name: "document",
        description:
          "The open design document. Blocks are listed in order; block ids are regenerated on every parse (index-based, v1).",
        data: {
          document: {
            id: input.document.id,
            name: input.document.name,
            blocks: describeBlocks(input.blocks, input.renderCache),
            selection: input.selection,
          },
        },
        state: { files: input.filesState, document: input.documentState },
      }
    : {
        name: "files",
        description:
          "The document list; no document is open.",
        data: {
          documents: input.documents.map((d) => ({
            id: d.id,
            name: d.name,
            updatedAt: d.updatedAt,
          })),
        },
        state: { files: input.filesState },
      };

  return {
    version: 1,
    host: { name: "design-studio", kind: "browser", version: APP_VERSION },
    view,
    navigation,
    actions: HOST_ACTIONS,
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    captured_at: new Date().toISOString(),
  };
}
