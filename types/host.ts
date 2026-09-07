import { z } from "zod";

// Host contract v1 (runtime docs/host-contract.md). Wire shapes only.

export const HostKindSchema = z.enum([
  "browser",
  "mobile",
  "desktop",
  "terminal",
  "service",
  "other",
]);

export const AttachmentSchema = z
  .object({
    kind: z.enum(["image", "document", "text"]).optional(),
    purpose: z.enum(["reference", "screenshot"]).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    media_type: z.string().optional(),
    data_uri: z.string().optional(),
    url: z.string().optional(),
    text: z.string().optional(),
  })
  .refine(
    (a) =>
      [a.data_uri, a.url, a.text].filter((v) => v !== undefined).length === 1,
    { message: "exactly one of data_uri, url, text" },
  );
export type Attachment = z.infer<typeof AttachmentSchema>;

export const HostActionSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  description: z.string(),
  parameters: z.object({ type: z.literal("object") }).passthrough(),
});
export type HostAction = z.infer<typeof HostActionSchema>;

export const HostViewSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  state: z.record(z.unknown()).optional(),
});
export type HostView = z.infer<typeof HostViewSchema>;

export const NavigationEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  route: z.string().optional(),
});
export type NavigationEntry = z.infer<typeof NavigationEntrySchema>;

export const HostContextSchema = z.object({
  version: z.literal(1),
  host: z.object({
    name: z.string(),
    kind: HostKindSchema,
    version: z.string(),
  }),
  view: HostViewSchema.optional(),
  navigation: z.array(NavigationEntrySchema).max(50).optional(),
  actions: z.array(HostActionSchema).max(32).optional(),
  attachments: z.array(AttachmentSchema).max(16).optional(),
  background: z
    .record(z.object({ state: z.string(), summary: z.record(z.unknown()) }))
    .optional(),
  captured_at: z.string(),
  extensions: z.record(z.unknown()).optional(),
});
export type HostContext = z.infer<typeof HostContextSchema>;

// The host action the runtime is waiting on (final_response.pending_tool_call).
export const PendingHostActionSchema = z.object({
  callId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.unknown()),
  /** Further host actions from the same response that the runtime will hand over next. */
  queued: z.array(z.string()).default([]),
});
export type PendingHostAction = z.infer<typeof PendingHostActionSchema>;

// What the app hands back after performing (or failing to perform) an action.
export interface HostActionResult {
  callId: string;
  result: unknown;
  outcome: "success" | "failed";
}
