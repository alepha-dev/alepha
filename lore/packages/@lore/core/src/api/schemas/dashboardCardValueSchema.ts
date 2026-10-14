import { type Infer, z } from "alepha";

import { dashboardCardLinkSchema } from "./dashboardCardLinkSchema.ts";
import { dashboardEmptyReasonSchema } from "./dashboardEmptyReasonSchema.ts";
import { dashboardTileStateSchema } from "./dashboardTileStateSchema.ts";

/**
 * What one card resolved to.
 *
 * Numbers and keys only — never formatted copy. The locale decides how
 * `1284` reads and what "all projects" is called, and both of those are the
 * browser's business. Titles inside `rows` are data (a quest's own title),
 * not copy, and are the one exception.
 *
 * ## Three answers that must never be confused (#E77, folio #F1364)
 *
 * - **`ok: false`** — the metric FAILED: the resolver threw, the scope is
 *   gone, the key is unknown. The tile says "could not load".
 * - **`empty`** — the metric ANSWERED that there is nothing to measure here:
 *   no release in the project, no app reporting, no folio. The computed board
 *   drops the tile; a customized board collapses it and shows the reason in
 *   edit mode only, so a reader never sees a permanent zero.
 * - **`value: 0`** — a MEASURED zero: there are open quests to count and
 *   none of them is held. A real fact, shown as a number.
 *
 * ## The richer shapes are all optional
 *
 * `series`, `markers`, `rows` and `segments` arrived with #E77 and are read
 * by the renderer the catalogue's `presentation` picks. A metric fills the
 * ones its presentation draws and nothing else, so the six scalar and
 * progress metrics that predate them resolve exactly as before.
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
   * - `activeQuests` — `todoCount`, `inProgressCount`
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
  link: dashboardCardLinkSchema.optional(),
  /**
   * Whether the figure is reconstructed from a sample rather than measured.
   * The UI must not render an estimate in the typography of a measurement.
   */
  estimated: z.boolean().optional(),
  /**
   * Why there is nothing to show, when there is nothing to show. See the
   * class doc: distinct from `ok: false` and from `value: 0`.
   */
  empty: dashboardEmptyReasonSchema.optional(),
  /**
   * Ordered points, oldest first, for a `trend` sparkline or a `chart`.
   * `at` is an ISO date (a day) or datetime; `value` is the measurement.
   */
  series: z
    .array(z.object({ at: z.string(), value: z.number() }))
    .max(400)
    .optional(),
  /**
   * Events drawn over a `chart` as dashed rules: a deployment on an error
   * chart. `kind` is a code the locale names.
   */
  markers: z
    .array(z.object({ at: z.string(), kind: z.string() }))
    .max(100)
    .optional(),
  /**
   * List items for `list`, `status` and `feed` tiles.
   *
   * - `id` — a typed reference (`Q2641`, `E77`, `F12`, `R0.33.0`) shown as a
   *   chip, or an app copy's `app/env`.
   * - `title` — the row's own name, data rather than copy.
   * - `meta` — a short right-aligned fact (an assignee, an area), data.
   * - `badge` — a code the locale names (`held`, `stale`, `overdue`).
   * - `at` — an ISO datetime, rendered relative on a feed, and on a list row
   *   that has no meta (a due date, a reminder).
   * - `excerpt` — a second, muted line on a feed (a completion message's
   *   first line), data.
   * - `value` / `progress` — a count, and a 0-100 bar for a row that has one.
   * - `state` — the pill's tone.
   */
  rows: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string(),
        meta: z.string().optional(),
        badge: z.string().optional(),
        at: z.string().optional(),
        excerpt: z.string().max(200).optional(),
        value: z.number().optional(),
        progress: z.number().min(0).max(100).optional(),
        state: dashboardTileStateSchema.optional(),
        link: dashboardCardLinkSchema.optional(),
      }),
    )
    .max(50)
    .optional(),
  /**
   * Stacked parts of a `progress` bar, in drawing order. `label` is a code
   * the locale names (`done`, `inProgress`, `todo`) or, for a breakdown by
   * area or tag, the area or tag itself.
   */
  segments: z
    .array(
      z.object({
        label: z.string(),
        value: z.number().min(0),
        state: dashboardTileStateSchema.optional(),
      }),
    )
    .max(50)
    .optional(),
});

export type DashboardCardValue = Infer<typeof dashboardCardValueSchema>;
