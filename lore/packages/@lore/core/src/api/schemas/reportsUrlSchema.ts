import { type Infer, z } from "alepha";

/**
 * The Reports filter bar's state, as the page query carries it (#Q2996), so a
 * report link is shareable.
 *
 * ⚠️ Free text on purpose, like `projectQuests`' query: a schema that rejects
 * an unknown value turns a stale bookmark into an error page. `ReportsUrlQuery`
 * decodes each param and drops what it refuses.
 */
export const reportsUrlSchema = z.object({
  /**
   * A preset (`7d`, `30d`, `90d`, `6m`, `1y`, `all`), or `custom` with `from`
   * and `to`. A preset stays relative to today, so a link keeps meaning "the
   * last 30 days" when it is opened next month.
   */
  range: z.text().optional(),
  from: z.text().optional(),
  to: z.text().optional(),
  grain: z.text().optional(),
  compare: z.text().optional(),
  area: z.text().optional(),
  epicId: z.text().optional(),
  releaseId: z.text().optional(),
  tag: z.text().optional(),
  priority: z.text().optional(),
  memberId: z.text().optional(),
});

export type ReportsUrl = Infer<typeof reportsUrlSchema>;
