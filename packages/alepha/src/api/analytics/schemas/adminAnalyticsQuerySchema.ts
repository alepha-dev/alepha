import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * The wire form of `AnalyticsQuery`. Key membership — which dimensions and
 * measures actually exist on the target dataset — is validated by
 * `AdminAnalyticsService` against the declaration; a static schema cannot
 * know it.
 */
export const adminAnalyticsQuerySchema = z.object({
  /**
   * First UTC day included, `YYYY-MM-DD`.
   */
  since: z.text().regex(/^\d{4}-\d{2}-\d{2}$/),
  /**
   * Last UTC day included, `YYYY-MM-DD`. Omitted means "up to the newest
   * bucket there is".
   *
   * `AnalyticsQuery` has carried this since the entity gained it while the
   * wire schema did not, which made the one thing `until` exists for
   * inexpressible over HTTP: comparing a bounded window against another
   * bounded window. The admin explorer's `until` control and its `compare
   * to` baseline both send it.
   */
  until: z
    .text()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  where: z
    .record(
      z.text(),
      z.union([
        z.text(),
        z.number(),
        z.object({ inArray: z.array(z.union([z.text(), z.number()])) }),
      ]),
    )
    .optional(),
  groupBy: z.array(z.text()).optional(),
  select: z.record(z.text(), z.literal("sum")),
  orderBy: z
    .object({ key: z.text(), direction: z.enum(["asc", "desc"]) })
    .optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export type AdminAnalyticsQuery = Infer<typeof adminAnalyticsQuerySchema>;
