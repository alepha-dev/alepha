import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const identityQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
  provider: z.string().optional(),
});

export type IdentityQuery = Infer<typeof identityQuerySchema>;
