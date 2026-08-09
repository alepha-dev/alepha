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
 * ## What does not live here yet
 *
 * The aggregate entities and `SigilIngestService` are still in `apps/lore`.
 * Moving them needs one design decision first: they carry
 * `db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" })`, and
 * `sigils` is the consuming app's entity — it references that app's projects.
 * The cascade is load-bearing (deleting an app erases everything it reported),
 * so the ref cannot simply be dropped for a plain uuid; it has to be
 * parameterised by the consuming app. Until that is settled the entities stay
 * where their foreign key is.
 */

export * from "./AnalyticsStore.ts";
export * from "./vitalsPercentile.ts";
