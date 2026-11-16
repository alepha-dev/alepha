import type { DashboardCardResource } from "../schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import type { DashboardReadShare } from "./DashboardReadShare.ts";
import type { ResolvedDashboardScope } from "./DashboardScopeService.ts";

/**
 * One card, with its scope already proven against the caller's memberships.
 *
 * A resolver never sees a raw scope, and never sees an id it may not read:
 * `DashboardScopeService` has already turned the stored configuration into
 * lists it is allowed to narrow with.
 */
export interface DashboardResolvable {
  card: DashboardCardResource;
  scope: ResolvedDashboardScope;
  /**
   * The metric's filters, already parsed against its own schema.
   */
  filters: Record<string, unknown>;
  /**
   * The board's time window, in days (#E77): what a delta compares against
   * and how far back a series reaches. One window for the whole board, so
   * every tile's deltas and sparklines agree.
   */
  windowDays: number;
  evaluatedAt?: string;
  /**
   * The reads this board resolution shares between its metrics (#Q3490):
   * one share for every entry of one `resolveOn` call. Optional because a
   * resolver called outside a board (a spec, an automation) has nothing to
   * share with, and reads directly.
   */
  reads?: DashboardReadShare;
  /**
   * What the reader's rank holds in each project of the board (#Q3794), by
   * project id. The registry has already dropped from `scope` the projects
   * where the reader lacks the metric's own `requires`; a resolver that
   * draws several kinds of row in one tile ("needs you", the activity feed)
   * reads this to leave out the kinds the reader may not see. Absent
   * outside a board, where such a resolver shows nothing rank-gated.
   */
  permissions?: ReadonlyMap<number, readonly string[]>;
}

/**
 * The computing half of a metric registry entry.
 *
 * ## Why `resolveAll` takes a list
 *
 * Because the alternative is the QuestGraph incident's shape (folio #1057).
 * A dashboard of ten tiles that each fetch on their own is ten requests, and
 * ten requests that each run their own query is ten times the database work
 * — `/api/_batch` collapses transport, not statements. So the endpoint takes
 * the whole card list, groups it by metric, and hands each resolver every
 * card that is its own. Three cards on one metric is one query, not three.
 *
 * A resolver that cannot batch simply loops; the signature is what makes
 * batching possible, not mandatory.
 *
 * ## The contract
 *
 * Return one entry per input card, keyed by `card.id`. A resolver that
 * throws costs the whole metric, not the page — `DashboardMetricRegistry`
 * catches it and marks those cards `ok: false`.
 */
export interface DashboardMetricResolver {
  /**
   * The registry key this resolver answers for.
   */
  readonly metric: string;

  resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  >;

  /**
   * Refuse a card's filters before it is stored, for what their schema
   * cannot see: the Folio card refuses an encrypted folio (#Q3709). Called
   * with filters already parsed, on add, update and copy. Throws a 400 to
   * refuse; a metric with nothing to check leaves it out.
   */
  checkFilters?(
    projectId: number,
    filters: Record<string, unknown>,
  ): Promise<void>;
}
