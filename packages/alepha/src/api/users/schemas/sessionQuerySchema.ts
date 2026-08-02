import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const sessionQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
});

export type SessionQuery = Infer<typeof sessionQuerySchema>;
