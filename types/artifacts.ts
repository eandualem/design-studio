import { z } from "zod";

// Prompt artifacts (runtime docs/api.md#prompt-artifacts), shapes as observed.

export const ArtifactPolicySchema = z.object({
  assistant_edit: z.enum(["none", "propose", "autonomous"]),
  assistant_activate: z.boolean(),
  host_edit: z.boolean(),
});

export const ArtifactDefinitionSchema = z
  .object({
    name: z.string(),
    role: z.string(),
    required: z.boolean(),
    policy: ArtifactPolicySchema,
    live_version: z.number().nullable(),
  })
  .passthrough();
export type ArtifactDefinition = z.infer<typeof ArtifactDefinitionSchema>;

export const ArtifactProfileSchema = z
  .object({
    name: z.string(),
    durable: z.boolean(),
    artifacts: z.array(ArtifactDefinitionSchema),
  })
  .passthrough();
export type ArtifactProfile = z.infer<typeof ArtifactProfileSchema>;

/** A stored version (history rows, GET /{name}, mutation responses). */
export const ArtifactVersionSchema = z
  .object({
    id: z.number().nullable(),
    name: z.string(),
    content: z.string(),
    version: z.number().nullable(),
    is_active: z.boolean(),
    proposed_by: z.string().nullable(),
    created_at: z.string().nullable(),
    source: z.enum(["default", "store"]).optional(),
  })
  .passthrough();
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

export const ArtifactMutationSchema = ArtifactVersionSchema.extend({
  success: z.boolean(),
  message: z.string(),
  live_version: z.number().nullable(),
  durable: z.boolean(),
});
export type ArtifactMutation = z.infer<typeof ArtifactMutationSchema>;

/** What the style guide view renders for one artifact. */
export interface ArtifactView {
  definition: ArtifactDefinition;
  active: ArtifactVersion;
  history: ArtifactVersion[];
}
