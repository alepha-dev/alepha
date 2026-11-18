import { z } from "alepha";

/**
 * Settings > Notifications' add form (#Q3892): the event, who is notified
 * (`member:<id>` or `channel:<id>`), an optional filter, and a member's
 * channels. Pickers only, no text.
 */
export const notificationFormSchema = z.object({
  event: z.string().min(1).max(64),
  target: z.string().max(128).optional(),
  filter: z.string().max(255).optional(),
  inapp: z.boolean().optional(),
  email: z.boolean().optional(),
});
