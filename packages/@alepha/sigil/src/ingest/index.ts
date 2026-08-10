/**
 * The **receiving** half of a sigil — what a sink needs, as opposed to what a
 * reporting app needs.
 *
 * ## Why `/ingest` and not `/sink`
 *
 * In this package "sink" already means *the remote receiver*, and
 * `SigilSinkProvider` (`@alepha/sigil/server`) is the **outbound** client that
 * talks to one. Naming the receiving half `sink` would make the two names mean
 * opposite ends of the same wire. `/ingest` matches `SIGIL_INGEST_PATH`,
 * `SigilIngestController` and `SigilIngestService` — vocabulary already in use.
 *
 * ## What lives here
 *
 * {@link createSigilAnalyticsEntities} — the three aggregate tables (views,
 * uniques, vitals), as a factory. They carry
 * `db.ref(…, () => sigils.cols.id, { onDelete: "cascade" })` and `sigils`
 * belongs to the *consuming* app, so the reference is a parameter rather than
 * something this package can own: see that file for why dropping the cascade
 * instead would have been the worse trade.
 *
 * {@link vitalsP75} and {@link summariseVitals} — the percentile maths every
 * vitals histogram consumer shares, whichever backend produced the histogram.
 *
 * ## What moved out
 *
 * The `AnalyticsStore` interface and its three implementations
 * (`createOrmAnalyticsStore`, `MemoryAnalyticsStore`, `WaeAnalyticsStore`) are
 * gone. That was a question-shaped storage contract this module used to own
 * for views, uniques and vitals alike; `@alepha/analytics`'s `$analytics()`
 * primitive replaced it end to end for **views and vitals** — sampling,
 * rollup and retention all included, on both a relational database and
 * Workers Analytics Engine.
 *
 * **Unique visitors never moved.** A distinct count cannot survive sampling or
 * a rollup, so an app that sinks telemetry — `apps/lore`'s
 * `LoreAnalyticsStore` is the one instance today — still writes and reads
 * `sigil_uniques_daily` directly, with its own small repository-backed store
 * rather than anything from this module. Error groups stay bespoke for the
 * same reason `AnalyticsStore` never covered them in the first place: they
 * keep the *first* stack sample, which needs a read before every write, and
 * an append-only analytics backend cannot do that.
 *
 * The three tables {@link createSigilAnalyticsEntities} declares still exist
 * for a reason beyond history: the views and vitals tables carry rows already
 * written by every deployment that ran before this migration, and dropping a
 * `$entity` here would ask `yarn check:migrations` to drop the table under
 * them. Nothing in this package — or in `apps/lore` — reads or writes the
 * views/vitals tables anymore; they are kept declared, not kept live.
 *
 * ## What does not live here yet
 *
 * `SigilIngestService`'s envelope handling — path normalisation, the country
 * and visitor plumbing, error groups and blights — is still in `apps/lore`.
 * Only the parts that are storage are here.
 */

export * from "./createSigilAnalyticsEntities.ts";
export * from "./vitalsPercentile.ts";
