import { z } from "zod";

export const MAX_SAVE_RETRIES = 2;

export const BlockKindSchema = z.enum(["text", "diagram"]);
export type BlockKind = z.infer<typeof BlockKindSchema>;

/** One block of a parsed document. Ids are index-based and regenerated on every parse (v1). */
export interface Block {
  id: string;
  kind: BlockKind;
  /** The block's Markdown source, including the fence for diagrams. */
  source: string;
  /** For diagrams: the Mermaid text inside the fence. */
  code: string | null;
  /** First line, truncated, for the host context. */
  summary: string;
}

export type RenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: string };

/** What a host action reports about a diagram block. */
export type RenderReport =
  | { ok: true }
  | { ok: false; error: string; block_id: string };

export const EditActionSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("create_document"),
    args: z.object({ name: z.string().min(1), content: z.string() }),
  }),
  z.object({
    name: z.literal("open_document"),
    args: z
      .object({ document_id: z.string().optional(), name: z.string().optional() })
      .refine((a) => a.document_id || a.name, {
        message: "document_id or name is required",
      }),
  }),
  z.object({
    name: z.literal("replace_block"),
    args: z.object({ block_id: z.string(), content: z.string() }),
  }),
  z.object({
    name: z.literal("insert_block"),
    args: z.object({ after_block_id: z.string(), content: z.string() }),
  }),
  z.object({
    name: z.literal("delete_block"),
    args: z.object({ block_id: z.string() }),
  }),
  z.object({
    name: z.literal("rename_document"),
    args: z.object({ document_id: z.string(), name: z.string().min(1) }),
  }),
]);
export type EditAction = z.infer<typeof EditActionSchema>;
