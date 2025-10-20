import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { pageQuerySchema } from "@alepha/postgres";

export const identityQuerySchema = t.interface([pageQuerySchema], {
  userId: t.optional(t.uuid()),
  provider: t.optional(t.string()),
});

export type IdentityQuery = Static<typeof identityQuerySchema>;
