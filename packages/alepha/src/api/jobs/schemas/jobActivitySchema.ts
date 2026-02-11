import { type Static, t } from "alepha";

export const jobActivityPointSchema = t.object({
  date: t.text(),
  completed: t.integer(),
  failed: t.integer(),
});

export type JobActivityPoint = Static<typeof jobActivityPointSchema>;

export const jobActivityQuerySchema = t.object({
  days: t.optional(t.integer({ minimum: 1, maximum: 90 })),
});

export type JobActivityQuery = Static<typeof jobActivityQuerySchema>;
