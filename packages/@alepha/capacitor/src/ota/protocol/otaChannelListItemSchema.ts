import { type Infer, z } from "alepha";

/**
 * One channel `listChannels()` offers. The plugin decodes `id` as an
 * integer, so it is a position in the answer, not the channel's own id.
 */
export const otaChannelListItemSchema = z.object({
  id: z.integer(),
  name: z.text({ maxLength: 64 }),
  public: z.boolean(),
  allow_self_set: z.boolean(),
});

export type OtaChannelListItem = Infer<typeof otaChannelListItemSchema>;
