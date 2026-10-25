import { type Infer, z } from "alepha";

/**
 * The answer to `getChannel()` (`PUT /ota/channel`): the channel the server
 * resolves for this device, and whether the device may pick another one
 * itself.
 */
export const otaChannelGetResponseSchema = z.object({
  channel: z.text({ maxLength: 64 }),
  status: z.text({ maxLength: 32 }),
  allowSet: z.boolean(),
  message: z.text().optional(),
});

export type OtaChannelGetResponse = Infer<typeof otaChannelGetResponseSchema>;
