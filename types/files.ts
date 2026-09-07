import { z } from "zod";

export const DocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  sessionId: z.string(),
  updatedAt: z.string(),
});
export type StudioDocument = z.infer<typeof DocumentSchema>;

export const DocumentMetaSchema = DocumentSchema.pick({
  id: true,
  name: true,
  updatedAt: true,
});
export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;
