import { type Infer, z } from "alepha";

import { otaChannelListItemSchema } from "./otaChannelListItemSchema.ts";

/**
 * The answer to `listChannels()` (`GET /ota/channel`): a bare array, as the
 * pinned plugin decodes it, of the channels a device may assign itself.
 */
export const otaChannelListResponseSchema = z.array(otaChannelListItemSchema);

export type OtaChannelListResponse = Infer<typeof otaChannelListResponseSchema>;
