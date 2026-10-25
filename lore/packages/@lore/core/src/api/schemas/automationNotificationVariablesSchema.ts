import { z } from "alepha";

/**
 * Only bounded rendered prose and stable execution identities enter the outbox.
 */
export const automationNotificationVariablesSchema = z.object({
  title: z.string().max(16_384),
  text: z.string().max(16_384),
  html: z.string().max(16_384),
  href: z.string().max(2048),
  projectTitle: z.string().max(255),
  scope: z.string().max(64),
  automationId: z.uuid(),
  ruleRevision: z.integer().nonnegative(),
  actionIndex: z.integer().min(0).max(4),
  recipientUserId: z.uuid(),
  category: z.enum(["automations", "releases", "reminders"]),
});
