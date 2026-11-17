import { z } from "alepha";

/**
 * Only bounded rendered prose and stable execution identities enter the outbox.
 */
export const automationNotificationVariablesSchema = z.object({
  title: z.string().max(16_384),
  text: z.string().max(16_384),
  html: z.string().max(16_384),
  href: z.string().max(2048),
  /**
   * `href` made absolute, for an email's button. Optional: a message queued
   * before it existed still renders (#Q3541).
   */
  url: z.string().max(2048).optional(),
  /**
   * The rule's own page, absolute, for an email's footer.
   */
  manageUrl: z.string().max(2048).optional(),
  projectTitle: z.string().max(255),
  scope: z.string().max(64),
  automationId: z.uuid(),
  ruleRevision: z.integer().nonnegative(),
  /**
   * The action node that queued it (#Q3804), and the source its run
   * started at, whose read access the recipient must hold.
   */
  nodeId: z.string().max(64).optional(),
  sourceNode: z.string().max(64).optional(),
  /**
   * The member addressed; absent for a room, which is nobody's (#Q3613).
   */
  recipientUserId: z.uuid().optional(),
  /**
   * The channel instance the rule names (#Q3613), such as a Discord
   * channel's id; the payload's `type` is its kind. Absent before #Q3613,
   * when the two were one.
   */
  channelId: z.string().max(64).optional(),
  category: z.enum(["automations", "releases", "reminders"]),
});
