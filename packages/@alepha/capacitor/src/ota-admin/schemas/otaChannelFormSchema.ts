import { z } from "alepha";

/**
 * A new channel.
 */
export const otaChannelFormSchema = z.object({
  name: z.text({ maxLength: 64 }),
  allowSelfAssign: z.boolean(),
});
