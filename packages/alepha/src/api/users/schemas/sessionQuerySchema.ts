import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const sessionQuerySchema = t.extend(pageQuerySchema, {
  userId: t.optional(t.uuid()),
});

export type SessionQuery = Static<typeof sessionQuerySchema>;
