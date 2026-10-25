import { type Infer, z } from "alepha";

import { automationAdoptionPolicySchema } from "./automationAdoptionPolicySchema.ts";
import { automationResourceSchema } from "./automationResourceSchema.ts";
import { automationRuleSchema } from "./automationRuleSchema.ts";

export const automationAdoptionPreviewSchema = z
  .object({
    policy: automationAdoptionPolicySchema,
    title: z.string().max(255),
    description: z.string().max(2048),
    author: z.object({ id: z.uuid(), name: z.string().max(255) }).strict(),
    state: z.enum(["legacy", "pending", "adopted", "opted_out"]),
    markerVersion: z.integer().nonnegative().optional(),
    replacementId: z.uuid().optional(),
    candidate: automationResourceSchema.optional(),
    rule: automationRuleSchema,
    ready: z.boolean(),
    reason: z.string().max(1024).optional(),
    permissions: z.array(z.string()).max(16),
    channels: z.array(z.string()).max(2),
    recipients: z
      .array(
        z
          .object({ value: z.string().max(255), label: z.string().max(255) })
          .strict(),
      )
      .max(50),
    recipientsHasMore: z.boolean(),
    reminderCount: z.integer().nonnegative().optional(),
    reminders: z
      .array(
        z
          .object({
            id: z.integer(),
            shortId: z.integer(),
            assigneeId: z.uuid(),
            interval: z.string(),
            nextAt: z.datetime(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();
export type AutomationAdoptionPreview = Infer<
  typeof automationAdoptionPreviewSchema
>;
