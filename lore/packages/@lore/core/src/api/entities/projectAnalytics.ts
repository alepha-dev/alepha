import { z } from "alepha";
import { $analytics } from "alepha/api/analytics";

/**
 * Core's portable analytics datasets (#E75: `LoreAnalytics` split per module,
 * dataset names unchanged): the project activity rates, keyed by project,
 * and the MCP tool calls, keyed by tool. Deploy's datasets (views, vitals,
 * errors, estate stats) are in `DeployAnalytics`.
 */
export class ProjectAnalytics {
  /**
   * How much happens in a project, by kind, over time (#E65).
   *
   * The counting half of the split decided on 2026-09-20: `$audit` keeps
   * `/project/activities`, which needs exact rows in exact time order with a
   * per-row payload, and this dataset takes the rates. A rollup folding a
   * day's identical events into one row carrying a count is a loss for a feed
   * and precisely the point for a bar, so the two questions stopped sharing
   * one table.
   *
   * What it replaces: Home's momentum bars used to read 13,428 `audits` rows
   * a load with an already optimal plan - a range seek per project over the
   * fourteen-day slice, plus a temp B-tree for a `GROUP BY` on a computed
   * `STRFTIME`. Fourteen days of activity simply IS 13,428 rows, so the cost
   * was the storage rather than the query. On Workers this dataset answers the
   * same question out of Analytics Engine and reads zero D1 rows.
   *
   * ## The four dimensions, decided rather than defaulted
   *
   * `project` is the index: Analytics Engine samples equitably per index
   * value, and per-project is the granularity every read here filters on. It
   * carries the audit row's `scopeId`, which is the project id as text.
   *
   * ⚠️ **Only project-scoped audit rows are recorded at all.** The app layer
   * (a sign-in, a project created before there is a project to file it under,
   * a parameter change) is `scopeId IS NULL` in `audits`, and there is no
   * project it belongs to. Those rows are SKIPPED rather than landing under
   * `""` - see `LoreAuditService`. An empty-string project would be a real
   * value on every backend, would be summed into no chart, and would still
   * consume Analytics Engine's per-index sampling budget.
   *
   * `type` and `action` are the audit row's own two columns, which is what
   * makes a "what kind of work happens here" chart possible: `type` is the
   * resource kind, `action` the verb.
   *
   * `actor` is the user id, or `system` for a write with no token behind it.
   * Bounded by a project's membership, so it groups safely.
   *
   * **No `resourceId`.** Unbounded cardinality, never grouped by, and
   * drilling from a bar into its events is what `/project/activities` is for.
   *
   * **No `area`, `epic` or `severity`.** None of the first two is on the audit
   * row, so recording either would mean a read per write on the hottest path
   * in the app. `severity` is on the row and free, and is still left out: it
   * is `info` on essentially every row here, because a failed write does not
   * usually reach the audit log at all. All three are cheap to ADD later - a
   * name goes on the end of the slot map and moves nothing - which is the
   * whole reason the list is allowed to start short.
   *
   * ## ⚠️ Append only, from the first commit
   *
   * Pinned like `errors` and `stats`, and for the reason `views` learned
   * twice: slots used to derive from alphabetically sorted names, so adding
   * `referrer` there cost eight days of history and adding `browser` would
   * have cost a month. A new dimension goes on the END of this list, whatever
   * it is called, and moves nothing. Reordering re-slots the whole dataset,
   * and Analytics Engine has no update or delete API to repair it with.
   *
   * `project` is a plain `z.text()` rather than a `db.ref` into `projects`,
   * which is where this dataset deliberately differs from the four above.
   * Those key on a `sigils` / `estates` row whose deletion is a real operator
   * action the UI warns about; a Lore project is soft-deleted (`deletedAt`)
   * and its `audits` rows carry the same untyped `scopeId` with no foreign
   * key. A cascade here would erase a project's rates on a hard delete while
   * its audit rows survived, which is the two halves of one split disagreeing.
   */
  public readonly activity = $analytics({
    name: "project_activity",
    index: "project",
    dimensions: z.object({
      /**
       * The audit row's `scopeId`: the project id, as text. Text rather than
       * an integer because that is what `audits.scopeId` is, and a dimension
       * that disagrees with the column it is copied from is a join waiting to
       * be got wrong.
       */
      project: z.string(),
      /**
       * The resource kind - `quest`, `folio`, `epic`, `release`, `member` and
       * the rest of `LoreAudits`.
       */
      type: z.string(),
      /**
       * The verb - `create`, `update`, `complete`, `publish`, and so on.
       */
      action: z.string(),
      /**
       * Who did it, as a user id, or `system` when the write carried no
       * token. Defaulted for the same SQLite reason every dimension on
       * `views` carries one: on the relational backend a later addition is
       * `ALTER TABLE ... ADD x text NOT NULL`, which SQLite refuses outright
       * on a table that already holds rows.
       */
      actor: z.string().default("system"),
    }),
    /**
     * One measure, and it is the audit row's `eventCount` rather than a bare
     * `1`.
     *
     * `$audit`'s `coalesce` folds a burst of identical writes into one row
     * carrying a count, so the relational query this replaces summed
     * `eventCount` for exactly that reason. Here every recorded event adds
     * one, because a point is written per `create()` CALL - including the
     * calls that merge into an existing row - so the sum matches
     * `SUM(event_count)` over the same window without the dataset having to
     * know what coalescing is.
     */
    measures: z.object({ count: z.number() }),
    slots: {
      dimensions: ["project", "type", "action", "actor"],
      measures: ["count"],
    },
    /**
     * Fourteen days is what Home draws, so 30d hot leaves a comfortable
     * margin of hour-precision rows; past that a day bucket is all any chart
     * here asks for. 400d cold matches the other four datasets.
     */
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });

  /**
   * How often each MCP tool is called, and how those calls end (#E65).
   *
   * ## The one question in this app with no data behind it at all
   *
   * MCP is Lore's primary consumer, and a tool call leaves **no row in any
   * entity table**. A write does produce an audit row, so `quest_update` is
   * visible after the fact as `quest:update` - but a read does not, and reads
   * are most of the traffic: `quest_get`, `project_context`, `folio_get`,
   * `quest_list` pass through this app and vanish. "Which tools do agents
   * actually call" was therefore unanswerable, in every surface, by
   * construction. This dataset is what makes it a chart.
   *
   * It is also what this epic's premise rested on: the store is worth more
   * than a daily counts table only if a FAMILY of event-rate charts exists.
   * `project_activity` was one member and could have been a D1 table; this is
   * the second, and it could not have been, because nothing was ever stored.
   *
   * ## Three dimensions
   *
   * `tool` is the index: Analytics Engine samples equitably per index value,
   * so a hot tool cannot starve a rare one out of the sample, and per-tool is
   * the granularity every read here groups by.
   *
   * `outcome` is `ok`, `refused` or `error`, which is what makes the chart
   * diagnostic rather than decorative. A tool that is called constantly and
   * refuses half those calls has a description or a schema that misleads, and
   * that is invisible in a total. `refused` is a status under 500 or an
   * `McpError` the caller cannot fix by retrying - the same split
   * `McpServerProvider` already makes when it decides whether to log at
   * `warn` or at `error`.
   *
   * `actor` is the calling user's id, or `anon`. Bounded by the instance's
   * accounts.
   *
   * **No `project`.** A tool names its project in its own arguments, under a
   * different key per tool and sometimes not at all (`project_list`), so the
   * value would be a per-tool guess written into one dimension. What happens
   * inside a project is `project_activity`'s question; this dataset's is what
   * the MCP surface itself is asked for.
   *
   * ## ⚠️ Append only, from the first commit
   *
   * Pinned like every dataset above. A new dimension goes on the END of the
   * list, whatever it is called. See `views` for what reordering cost twice.
   */
  public readonly mcpCalls = $analytics({
    name: "mcp_calls",
    index: "tool",
    dimensions: z.object({
      /**
       * The tool name as the MCP client asked for it - `quest_get`,
       * `project_context`. Unregistered names are recorded too, as
       * `unknown`: a client calling a tool that does not exist is exactly the
       * kind of thing worth seeing.
       */
      tool: z.string(),
      /**
       * `ok` | `refused` | `error`. Defaulted for the same SQLite reason
       * every dimension on `views` carries one.
       */
      outcome: z.string().default("ok"),
      /**
       * The calling user's id, or `anon` when the call carried no identity.
       */
      actor: z.string().default("anon"),
    }),
    measures: z.object({ count: z.number() }),
    slots: {
      dimensions: ["tool", "outcome", "actor"],
      measures: ["count"],
    },
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });
}
