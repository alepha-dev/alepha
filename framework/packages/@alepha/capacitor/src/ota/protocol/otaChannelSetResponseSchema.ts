import { type Infer, z } from "alepha";

/**
 * The answer to `setChannel()` (`POST /ota/channel`). `unset: true` tells the
 * plugin to drop its stored choice and follow the public channel again,
 * which is how a device leaves a self-assigned channel. A refusal comes with
 * a 4xx status and `error`.
 */
export const otaChannelSetResponseSchema = z.object({
  status: z.text({ maxLength: 32 }),
  message: z.text().optional(),
  error: z.text({ maxLength: 64 }).optional(),
  unset: z.boolean().optional(),
});

export type OtaChannelSetResponse = Infer<typeof otaChannelSetResponseSchema>;
