import { type Infer, z } from "alepha";

/**
 * What one card resolved to.
 *
 * Numbers and keys only — never formatted copy. The locale decides how
 * `1284` reads and what "all projects" is called, and both of those are the
 * browser's business.
 */
export const dashboardCardValueSchema = z.object({
  cardId: z.integer(),
  /**
   * Whether this metric answered.
   *
   * `false` costs a tile, never the page: one metric failing while its
   * neighbours succeed is a normal state on a dashboard whose cards read
   * unrelated tables.
   */
  ok: z.boolean(),
  /**
   * The headline figure. Absent when `ok` is false.
   */
  value: z.integer().optional(),
  /**
   * Percent change against the metric's own comparison window, when it has
   * one. Absent means there is nothing honest to say — no comparison, or a
   * zero baseline, where the change is undefined rather than infinite.
   */
  delta: z.number().optional(),
  /**
   * The footer facts, per metric. Keys are documented on each metric's
   * resolver and rendered by that metric's footer:
   *
   * - `activeQuests` — `newCount`, `acceptedCount`
   * - `openBlights` — `occurrences`, `apps`
   * - `untriagedFeedback` — `oldestWaitingDays`
   * - `uniqueVisitors` — `previous`
   */
  detail: z.record(z.text(), z.any()),
  /**
   * The names behind the scope, for the first chip: the projects or apps the
   * card is pointed at. Empty for an `all` scope, which names nothing.
   */
  scopeNames: z.array(z.string()),
  /**
   * Where clicking goes, as a route name plus params. Absent when the card
   * has no destination that exists — better no link than a 404.
   */
  link: z
    .object({
      route: z.string(),
      params: z.record(z.text(), z.string()).optional(),
      query: z.record(z.text(), z.string()).optional(),
    })
    .optional(),
  /**
   * Whether the figure is reconstructed from a sample rather than measured.
   * The UI must not render an estimate in the typography of a measurement.
   */
  estimated: z.boolean().optional(),
});

export type DashboardCardValue = Infer<typeof dashboardCardValueSchema>;
