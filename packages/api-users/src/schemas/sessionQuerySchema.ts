import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { pageQuerySchema } from "@alepha/postgres";

export const sessionQuerySchema = t.extend(pageQuerySchema, {
  userId: t.optional(t.uuid()),
});

export type SessionQuery = Static<typeof sessionQuerySchema>;
