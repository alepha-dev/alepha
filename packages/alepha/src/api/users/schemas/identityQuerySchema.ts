import type { Static } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const identityQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
  provider: z.string().optional(),
});

export type IdentityQuery = Static<typeof identityQuerySchema>;
