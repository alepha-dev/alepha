import { z } from "alepha";

export const automationCatalogChannelSchema = z.object({
  // A channel instance (#Q3613): its id, kind and name.
  key: z.string().max(64),
  kind: z.string().max(32).optional(),
  name: z.string().max(64).optional(),
  addressable: z.boolean(),
  available: z.boolean(),
  reason: z.string().optional(),
});
