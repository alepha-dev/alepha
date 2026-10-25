import { z } from "alepha";

import { automationValueSchema } from "./automationValueSchema.ts";

/**
 * No destructive operation or permission-management operation is representable.
 */
export const automationActionSchema = z.union([
  z
    .object({
      kind: z.literal("notify"),
      recipient: z.string().max(255).optional(),
      audience: z.literal("projectMembersExceptPublisher").optional(),
      channel: z.string().max(255),
      title: z.string().max(16_384),
      text: z.string().max(16_384),
      category: z.enum(["automations", "releases", "reminders"]),
    })
    .strict()
    .refine(
      (action) =>
        action.audience
          ? action.recipient === undefined
          : typeof action.recipient === "string",
      { message: "Choose one member or the explicit project audience" },
    ),
  z
    .object({
      kind: z.literal("appendFolio"),
      folio: z.string().max(255),
      text: z.string().max(16_384),
    })
    .strict(),
  z
    .object({
      kind: z.literal("createQuest"),
      title: z.string().min(1).max(255),
      description: z.string().max(16_384),
      area: z.string().max(255),
    })
    .strict(),
  z
    .object({
      kind: z.literal("assignRelease"),
      quest: automationValueSchema,
      release: automationValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("addTag"),
      quest: automationValueSchema,
      tag: z.string().min(1).max(255),
    })
    .strict(),
]);
