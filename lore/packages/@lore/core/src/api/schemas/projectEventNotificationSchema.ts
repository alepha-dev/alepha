import { type Infer, z } from "alepha";

/**
 * What a project event's notification renders (#Q3890): the fixed message
 * of its event, the project, and the link.
 */
export const projectEventNotificationSchema = z.object({
  projectTitle: z.string(),
  title: z.string(),
  text: z.string(),
  href: z.string(),
  url: z.string(),
  scope: z.string(),
  /**
   * The notification channel posted to (#Q3891), for the Discord template.
   */
  channelId: z.string().max(64).optional(),
});

export type ProjectEventNotification = Infer<
  typeof projectEventNotificationSchema
>;
