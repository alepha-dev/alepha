import { type Infer, z } from "alepha";

/**
 * What a run's reply email renders (#Q4278): the prompt and the project, the
 * reply already rendered to safe HTML and as text, the job's page, and the
 * chrome in the instance's notification language.
 */
export const promptReplyNotificationSchema = z.object({
  projectTitle: z.string(),
  promptTitle: z.string(),
  html: z.string(),
  text: z.string(),
  url: z.string(),
  lang: z.string(),
  /**
   * The reply was cut (by Bay's bound), or never captured (an older Bay).
   */
  cut: z.boolean(),
  missing: z.boolean(),
});

export type PromptReplyNotification = Infer<
  typeof promptReplyNotificationSchema
>;
