import { z } from "zod";

export const InspectionCommandSchema = z.object({
  type: z.literal("xstate-mcp.send"),
  requestId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(1024),
  event: z.record(z.unknown()),
}).strict();

export const InspectionDocumentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user.edit"), content: z.string().max(4000) }).strict(),
  z.object({ type: z.literal("user.retrySave") }).strict(),
]);
