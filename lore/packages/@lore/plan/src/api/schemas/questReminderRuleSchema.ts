import { type Infer, z } from "alepha";

/**
 * Whether the project has its quest reminder automation (#Q3626): without
 * it, a reminder set on a quest is never sent.
 */
export const questReminderRuleSchema = z
  .object({
    exists: z.boolean(),
    enabled: z.boolean(),
    automationId: z.uuid().optional(),
  })
  .strict();
export type QuestReminderRule = Infer<typeof questReminderRuleSchema>;
