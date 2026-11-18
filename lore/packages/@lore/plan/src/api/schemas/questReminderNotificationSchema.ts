import { type Infer, z } from "alepha";

/**
 * What a quest reminder renders (#Q3893): the quest, its project and the
 * link to it.
 */
export const questReminderNotificationSchema = z.object({
  projectTitle: z.string(),
  reference: z.string(),
  title: z.string(),
  href: z.string(),
  url: z.string(),
  scope: z.string(),
});

export type QuestReminderNotification = Infer<
  typeof questReminderNotificationSchema
>;
