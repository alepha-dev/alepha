import type { DashboardCardResource } from "../schemas/dashboardCardResourceSchema.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
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
  /** The metric's filters, already parsed against its own schema. */
  filters: Record<string, unknown>;
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
  /** The registry key this resolver answers for. */
  readonly metric: string;

  resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  >;
}
