import { type Infer, z } from "alepha";

/**
 * One error's occurrences per day over the last 30 days, with the project's
 * deploys marked (#E185).
 *
 * `empty` is the explicit answer for an error with no series: a `run` or an
 * `uptime` error, which no app reports, and a project with no app. Thirty
 * zeros would read as an error that stopped happening.
 */
export const projectErrorTrendSchema = z.object({
  empty: z.boolean(),
  /**
   * One point per day, oldest first, a day with no occurrence as a zero.
   */
  series: z.array(z.object({ at: z.string(), value: z.number() })),
  /**
   * The project's deployments that succeeded in the window.
   */
  markers: z.array(z.object({ at: z.string(), kind: z.enum(["deploy"]) })),
  /**
   * The occurrences in the window, the sum of the series.
   */
  total: z.number(),
});

export type ProjectErrorTrend = Infer<typeof projectErrorTrendSchema>;
