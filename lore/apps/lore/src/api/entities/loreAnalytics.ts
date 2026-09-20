import { z } from "alepha";
import { $analytics } from "alepha/api/analytics";
import { db } from "alepha/orm";

import { estates } from "./estates.ts";
import { sigils } from "./sigils.ts";

/**
 * Lore's six portable analytics datasets.
 *
 * Views, vitals and errors, keyed by sigil, the estate stats series, keyed by
 * estate, the project activity rates, keyed by project, and the MCP tool
 * calls, keyed by tool. Unique visitors stay in `sigilUniquesDaily` because a
 * distinct count cannot survive sampling or a rollup.
 *
 * ⚠️ `errors` here does NOT replace `sigilErrorGroups`. That table keeps the
 * *first* stack sample, which needs a read before every write, and holds one
 * row per `(sigilId, fingerprint)` with a running all-time total. This
 * dataset is the series that table cannot hold, because individual
 * occurrences are never stored there. Both are written from `absorbErrors`
 * and both are read; see `errors` below.
 *
 * `sigilId` is the index dimension on all three: Analytics Engine samples equitably
 * per index value, and per-app is the granularity every Insights read filters
 * on. It is also a real `db.ref` into `sigils`, `onDelete: "cascade"` — the
 * same shape `sigilErrorGroups` uses. Without it, once the legacy aggregate
 * tables are eventually deleted, deleting a sigil would orphan its analytics
 * here forever instead of erasing them, breaking the "rotate, don't delete"
 * guidance the UI gives operators specifically because the legacy tables
 * cascade. `db.ref` mutates the zod schema in place (`pgAttr`), so this
 * metadata survives `AnalyticsEntityFactory`'s spread into `$entity` — the
 * relational backend gets a real foreign key, and Memory / Analytics Engine
 * are unaffected since both only ever read `Object.keys(dimensions.shape)`.
 *
 * `SigilIngestService` writes views and vitals here exclusively —
 * `sigilViewsHourly` / `sigilVitalsHourly` used to receive the same rows
 * through a dual-write while `InsightsController` still read from them, but
 * both the read and the dual-write retired once Insights moved onto these
 * datasets. The two legacy tables stay declared only so
 * `yarn check:migrations` keeps agreeing with what is still physically on
 * disk; nothing in the app reads or writes them anymore.
 */
export class LoreAnalytics {
  public readonly views = $analytics({
    name: "sigil_views",
    index: "sigilId",
    dimensions: z.object({
      sigilId: db.ref(z.uuid(), () => sigils.cols.id, {
        onDelete: "cascade",
      }),
      path: z.string(),
      country: z.string(),
      /**
       * The cross-origin host the visit came from, or `direct`.
       *
       * Only a page load's own view carries one — a client-side navigation
       * inherits `document.referrer` unchanged, so counting it again would
       * turn one arrival into a whole session. `SigilIngestService` folds
       * everything else (no referrer, same-origin, a stripped
       * `referrer-policy`, a view that is not the landing one) into `direct`,
       * because none of those can be told apart from the sink and pretending
       * otherwise would invent precision.
       *
       * **Adding this dimension re-slotted the Analytics Engine wire format,
       * once, and it cost eight days of history.** Slots used to derive from
       * alphabetically sorted dimension names, so `referrer` landed between
       * `path` and `sigilId` and pushed `sigilId` along. Rows written before
       * that change carry a sigil id in a slot now read as a referrer, so they
       * match no `WHERE sigilId IN (…)` and are absent from every Insights
       * read, permanently, since Analytics Engine has no update or delete
       * API. Slots are pinned below now and this cannot recur; the pin is
       * what made the name a free choice again.
       *
       * The default is not decoration. On the relational backend this is
       * `ALTER TABLE … ADD referrer text NOT NULL`, and SQLite refuses that
       * outright on a table that already has rows unless the column carries a
       * non-null default — so without it the migration is one that generates
       * cleanly, passes `check:migrations`, and then fails on the first
       * deployment that has ever recorded a view.
       */
      referrer: z.string().default("direct"),
      /**
       * `utm_campaign` (else `utm_source`) from the landing URL, or `none`.
       *
       * Only an arrival can carry one, so every non-landing view is `none` —
       * which is why the campaign leaderboard sums `entries` rather than
       * `count`. Without this the tag is simply lost: `normalizePath` splits
       * on `?`, deliberately, so a link posted with `?utm_source=hn` is today
       * indistinguishable from an untagged one.
       */
      campaign: z.string().default("none"),
      /**
       * `mobile` | `tablet` | `desktop`, classified by the app's own proxy
       * from the user-agent it already holds. Three buckets on purpose — see
       * `sigilDeviceClass` for why a real UA parser would cost precision
       * everywhere else on this dataset.
       */
      device: z.string().default("desktop"),
      /**
       * `bot` | `human`, classified by the app's own proxy from the
       * user-agent it already holds. See `sigilTrafficKind` for what that
       * claim is worth: it catches a crawler that announces itself, and the
       * largest automated population on this project's own docs app announces
       * nothing at all. `human` therefore means "did not declare itself a
       * bot", and `engaged` remains the honest discriminator for the rest.
       *
       * **The name used to be load-bearing, and is not any more.** While
       * slots derived from alphabetically sorted names, a new dimension only
       * avoided re-slotting the wire format if it sorted LAST: `traffic`
       * sorts after `sigilId`, so it took the free slot and left every stored
       * row where it was, while `bot`, `kind`, `agent` or `class` would each
       * have misread every view ever recorded. Slots are pinned below now, so
       * the next dimension can be called whatever it should be called. The
       * name stays because it is the right one, not because of where it
       * sorts.
       *
       * Rows written before this dimension existed hold `""` here rather than
       * the default - a default applies when a row is written, not when an old
       * one is read. That is why the humans filter matches a SET rather than
       * one value; see `InsightsController.HUMAN_TRAFFIC`.
       *
       * The default is not decoration either, and it is the same trap
       * `referrer` and `engaged` both hit: on the relational backend this is
       * `ALTER TABLE ... ADD traffic text NOT NULL`, which SQLite refuses
       * outright on a table that already holds rows unless the column carries
       * a non-null default.
       */
      traffic: z.string().default("human"),
      /**
       * `chrome` | `safari` | `firefox` | `edge` | `other`, classified by the
       * app's own proxy from the user-agent it already holds. Five coarse
       * buckets on purpose - see `sigilBrowserName`.
       *
       * **This is the dimension that proves the slot map is fixed.** It sorts
       * before `campaign`, so under the old alphabetical derivation it would
       * have taken `blob3` and pushed EVERY dimension on this dataset along by
       * one, hiding another month of production data the way `referrer` hid
       * eight days. `traffic` escaped that by being named for where it sorted;
       * this one has no such escape, which is exactly why it was blocked on
       * the pin. It is appended to `slots.dimensions` below and takes the next
       * free blob.
       *
       * The default is not decoration, and it is the same trap `referrer`,
       * `traffic` and `engaged` all hit: on the relational backend this is
       * `ALTER TABLE ... ADD browser text NOT NULL`, which SQLite refuses
       * outright on a table that already holds rows unless the column carries
       * a non-null default.
       */
      browser: z.string().default("other"),
      /**
       * `windows` | `macos` | `ios` | `android` | `linux` | `other`, from the
       * same header and the same proxy. See `sigilOsName`, including why it
       * disagrees with `device` about an iPad.
       *
       * Sorts between `device` and `path`, so it too would have re-slotted
       * this dataset under the old derivation. Appended, like `browser`, and
       * defaulted for the same SQLite reason.
       */
      os: z.string().default("other"),
      /**
       * `user` | `anon`: whether a session was on the request the reporting
       * app's own server handled.
       *
       * ⚠️ **Cookie sessions only.** The browser reaches the proxy with a
       * plain same-origin `fetch`, which carries cookies and no
       * `Authorization` header, so an app holding its token in memory reports
       * every view as `anon` - silently, and correctly, since there is no
       * session on that request. Lore itself qualifies; read a flat 0% signed
       * in as this before reading it as a defect.
       *
       * Sorts FIRST of all nine names, so under the old alphabetical
       * derivation this one dimension would have moved every slot on the
       * dataset - the worst case the pin below exists to prevent. Appended,
       * it moves nothing.
       *
       * Defaulted for the same SQLite reason as `browser` and `os`, and with
       * the same consequence: rows written before it existed hold `""`, not
       * `"anon"`, because a default applies when a row is written and not
       * when an old one is read. `InsightsController` folds the empty string
       * into anon on the way out.
       */
      auth: z.string().default("anon"),
    }),
    /**
     * Three measures, and the two new ones cost nothing on the wire.
     *
     * Measure slots were derived alphabetically the same way dimension slots
     * were, but `count` sorts before both `engaged` and `entries`, so it kept
     * `double1` and no stored row was misread. That was luck, not a property
     * of measures; both spaces are pinned below now, and both are append-only
     * for the same reason.
     *
     * `engaged` arrives on its own row with `count: 0`, because Analytics
     * Engine is append-only and engagement is not knowable when the view is
     * recorded. Summing the two independently is what makes that work.
     */
    measures: z.object({
      count: z.number(),
      /**
       * Defaulted for the same reason the new dimensions are, and it is the
       * same trap: on the relational backend this is
       * `ALTER TABLE … ADD engaged real NOT NULL`, which SQLite rejects
       * outright on a table that already holds rows. Zero is also the right
       * value for every row written before engagement existed — none of them
       * measured any.
       */
      engaged: z.number().default(0),
      entries: z.number().default(0),
    }),
    /**
     * The wire format, and the reason the two comments above talk about
     * `blob8` and about `traffic` having to sort last.
     *
     * These positions are exactly the ones alphabetical derivation produced
     * on 2026-08-26, so pinning them moves nothing: every row Analytics
     * Engine already holds under the current layout stays readable. What
     * changes is the future - the next dimension goes on the END of this
     * list and pushes nothing, whatever it is called.
     *
     * ⚠️ Rows written between 2026-08-10 and 2026-08-18 carry the
     * pre-`referrer` layout (`sigilId` in `blob5`, then `blob7`) and are
     * **knowingly unreadable**. They match no `WHERE sigilId IN (…)` and so
     * count as absent. Analytics Engine has no update or delete API, so
     * there is nothing to repair them with; they leave the widest window
     * this dataset offers (30d) on 2026-09-17 and the gap closes itself. Do
     * not add a second read path for them: the values are recoverable only
     * by guessing which generation a row belongs to from which trailing
     * blobs are empty, and a leaderboard filled from the wrong dimension is
     * worse than a gap.
     */
    slots: {
      dimensions: [
        "campaign",
        "country",
        "device",
        "path",
        "referrer",
        "sigilId",
        "traffic",
        // Appended, and the first two names to arrive here since the list
        // became the wire format. Both sort EARLY - `browser` before
        // `campaign`, `os` between `device` and `path` - so under the old
        // alphabetical derivation adding them would have moved every slot on
        // this dataset. Appended, they move nothing.
        "browser",
        "os",
        // Appended, like the two above, and this one is the case that makes
        // the argument: `auth` sorts FIRST of all nine, so the old
        // alphabetical derivation would have pushed every single slot on this
        // dataset along and made every stored row unreadable - the 2026-08-10
        // incident again, and worse. On the end of the list it moves nothing.
        "auth",
      ],
      measures: ["count", "engaged", "entries"],
    },
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });

  /**
   * Web vitals as a histogram.
   *
   * `bucket` is an ordinary dimension rather than anything special: a
   * percentile cannot be merged across buckets but a histogram can, so the
   * bucket index is a grouping key and the count is the measure.
   */
  public readonly vitals = $analytics({
    name: "sigil_vitals",
    index: "sigilId",
    dimensions: z.object({
      sigilId: db.ref(z.uuid(), () => sigils.cols.id, {
        onDelete: "cascade",
      }),
      metric: z.string(),
      path: z.string(),
      bucket: z.number(),
    }),
    measures: z.object({ samples: z.number() }),
    /**
     * Pinned at the positions alphabetical derivation already gave them, so
     * every stored row stays readable. Append only - see `views` above and
     * `AnalyticsSlotMap`.
     */
    slots: {
      dimensions: ["bucket", "metric", "path", "sigilId"],
      measures: ["samples"],
    },
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });

  /**
   * Error occurrences over time, which `sigilErrorGroups` structurally
   * cannot answer.
   *
   * That table holds ONE row per `(sigilId, fingerprint)` with a running
   * total, deliberately: individual occurrences are never kept, so there is
   * no series in it to plot. Its `count` is the group's ALL-TIME total, and
   * `readErrorGroups` filters on `lastSeenAt`, so a chart fed from it would
   * plot lifetime totals against a window and be wrong in a way no reader
   * could detect. Feedback #2085 asked for "a graph of count of errors,
   * typed by server/browser"; this dataset is what makes that a true graph.
   *
   * It does NOT replace `sigilErrorGroups`. That table keeps the first stack
   * sample, which needs a read before every write, and an append-only
   * dataset cannot do that. The two answer different questions and both are
   * written from `absorbErrors`.
   *
   * Cheap by construction: the sender already folds a window of identical
   * failures and sends a `count`, `absorbErrors` folds again by fingerprint,
   * and `recordMany` takes the whole envelope at once. On Workers that is
   * one `writeDataPoint` per row into Analytics Engine, not a D1 round trip
   * - which matters, because ingest latency on this path was already
   * measured as almost entirely time spent waiting (folio #1151).
   *
   * ⚠️ Both traps the other two datasets document apply here from the
   * start. Every dimension carries a NON-NULL DEFAULT, because on the
   * relational backend a later addition is `ALTER TABLE … ADD x text NOT
   * NULL`, which SQLite refuses outright on a table that already holds rows.
   * And `sigilId` is a real `db.ref` with `onDelete: "cascade"`, so deleting
   * a sigil erases its error history instead of orphaning it - the same
   * shape `views`, `vitals` and `sigilErrorGroups` all use, and the reason
   * the UI can keep telling operators to rotate rather than delete.
   */
  public readonly errors = $analytics({
    name: "sigil_errors",
    index: "sigilId",
    dimensions: z.object({
      sigilId: db.ref(z.uuid(), () => sigils.cols.id, {
        onDelete: "cascade",
      }),
      /**
       * `client` or `server`, which is the split the report asked for. A
       * dimension rather than a measure because it groups; the count is what
       * is summed.
       */
      origin: z.string().default("client"),
      /**
       * Which distinct failure. Carried so the worst-offenders list can one
       * day come from here too, and so a single runaway fingerprint is
       * visible as one rather than smeared across the origin totals.
       *
       * ⚠️ Unbounded cardinality in principle. Analytics Engine samples
       * equitably per INDEX value and the index is `sigilId`, so this does
       * not fragment the sampling; it does mean a `groupBy: ["fingerprint"]`
       * read wants a `limit`, exactly like `path` on `views`.
       */
      fingerprint: z.string().default(""),
    }),
    measures: z.object({ count: z.number() }),
    /**
     * Pinned from the first commit, so this dataset never has to learn the
     * lesson `views` learned twice. A new dimension goes on the END of this
     * list, whatever it is called, and moves nothing.
     */
    slots: {
      dimensions: ["fingerprint", "origin", "sigilId"],
      measures: ["count"],
    },
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });

  /**
   * An estate's CPU and memory over time (#1627): the series behind the
   * gauge on the `estates` row.
   *
   * The two are different questions and live in different places on
   * purpose. "CPU is 34% right now" is the gauge, upserted onto the estate
   * row by `EstateStatsService` on every push, exact and never growing.
   * "CPU over 30 days" is this dataset, written on the same push only while
   * the estate's `collectSeries` switch is on. Nothing appends a row per
   * push to D1: on Workers this is a `writeDataPoint` into Analytics Engine.
   *
   * ⚠️ The gauge must never be read back from here. Every measure comes back
   * as a sample-corrected SUM, and a point value is not a sum. That is also
   * why the measures are sums and a sample count rather than percentages:
   * `sum` is the one aggregate that survives a rollup and a sampled backend,
   * so the mean of a day is `cpu / samples` on the way out
   * (`EstateStatsService.series`), never a stored average of averages.
   *
   * `estateId` is the index dimension and a real `db.ref` into `estates`
   * with `onDelete: "cascade"`, the same shape `sigilId` has above and for
   * the same reason: on the relational backend deleting an estate erases
   * its series instead of orphaning it. Memory and Analytics Engine ignore
   * the reference, since both only read `Object.keys(dimensions.shape)`.
   *
   * Pinned from the first commit, like `errors`. A new dimension goes on the
   * END of the list, whatever it is called, and moves nothing.
   */
  public readonly stats = $analytics({
    name: "estate_stats",
    index: "estateId",
    dimensions: z.object({
      estateId: db.ref(z.uuid(), () => estates.cols.id, {
        onDelete: "cascade",
      }),
    }),
    measures: z.object({
      cpu: z.number(),
      memory: z.number(),
      samples: z.number(),
    }),
    slots: {
      dimensions: ["estateId"],
      measures: ["cpu", "memory", "samples"],
    },
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });

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
