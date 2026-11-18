import { z } from "alepha";

/**
 * The Channels tab's add and edit form (#Q3614). Editing leaves `url` empty
 * to keep the current webhook.
 */
export const projectChannelFormSchema = z.object({
  kind: z.enum(["discord", "webhook"]).optional(),
  name: z.string().min(1).max(64),
  url: z.string().max(2048).optional(),
});
