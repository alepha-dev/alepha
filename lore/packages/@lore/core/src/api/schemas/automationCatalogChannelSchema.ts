import { z } from "alepha";

export const automationCatalogChannelSchema = z.object({
  key: z.string().max(32),
  addressable: z.boolean(),
  available: z.boolean(),
  reason: z.string().optional(),
});
