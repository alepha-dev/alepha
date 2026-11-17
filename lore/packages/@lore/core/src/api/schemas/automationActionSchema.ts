import { type Infer, z } from "alepha";

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
      /**
       * One channel: the form a run's snapshot holds, one notify per channel
       * (`AutomationRuleChannels.expand`), and every rule before #Q3613.
       */
      channel: z.string().max(255).optional(),
      /**
       * The channels a stored rule notifies (#Q3613), one or more. A room
       * (a channel that is not addressable) needs no recipient.
       */
      // Empty only once every channel it named was deleted (#Q3613): the
      // rule is then broken, and an authored rule names at least one.
      channels: z.array(z.string().min(1).max(255)).max(8).optional(),
      title: z.string().max(16_384),
      text: z.string().max(16_384),
      category: z.enum(["automations", "releases", "reminders"]),
    })
    .strict()
    .refine((action) => (action.channel === undefined) !== !action.channels, {
      message: "Name either one channel or a list of channels",
    })
    .refine((action) => !(action.audience && action.recipient !== undefined), {
      message: "Choose one member or the explicit project audience",
    }),
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

export type AutomationAction = Infer<typeof automationActionSchema>;
