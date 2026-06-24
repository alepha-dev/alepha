import type { Static } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const sessionQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
});

export type SessionQuery = Static<typeof sessionQuerySchema>;
