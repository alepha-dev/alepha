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
 * {@link AnalyticsStore}, the contract a sink's storage has to satisfy, and the
 * percentile maths every implementation of it shares. The interface is
 * deliberately a closed set of questions rather than a query surface — see its
 * own docstring for why that is forced by the two known backends aggregating at
 * opposite ends.
 *
 * {@link createSigilAnalyticsEntities} — the three aggregate tables, as a
 * factory. They carry `db.ref(…, () => sigils.cols.id, { onDelete: "cascade" })`
 * and `sigils` belongs to the *consuming* app, so the reference is a parameter
 * rather than something this package can own: see that file for why dropping
 * the cascade instead would have been the worse trade.
 *
 * {@link createOrmAnalyticsStore} and {@link MemoryAnalyticsStore} — the two
 * default implementations. The orm one is what every Node / Postgres
 * deployment runs and what answers unique visitors even on Cloudflare; the
 * memory one exists because `vitest` cannot exercise an Analytics Engine
 * binding and `wrangler dev` treats its writes as no-ops.
 *
 * ## What does not live here yet
 *
 * `SigilIngestService`'s envelope handling — path normalisation, the country
 * and visitor plumbing, error groups and blights — is still in `apps/lore`.
 * Only the parts that are storage are here.
 */

export * from "./AnalyticsStore.ts";
export * from "./createOrmAnalyticsStore.ts";
export * from "./createSigilAnalyticsEntities.ts";
export * from "./MemoryAnalyticsStore.ts";
export * from "./vitalsPercentile.ts";
export * from "./WaeAnalyticsStore.ts";
