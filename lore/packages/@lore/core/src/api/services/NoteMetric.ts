import { $inject } from "alepha";

import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";

/**
 * A note the owner writes (#Q2659): its body is the card's own
 * `filters.markdown`, which the renderer reads without waiting for this.
 * Resolved only so the card is never "unknown"; an empty note is `empty`,
 * so a reader never sees a blank tile.
 */
export class NoteMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "note";

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    return new Map(
      cards.map((entry) => {
        const markdown = entry.filters.markdown;
        return [
          entry.card.id,
          typeof markdown === "string" && markdown.trim().length > 0
            ? { detail: {} }
            : { empty: "noData" as const, detail: {} },
        ];
      }),
    );
  }
}
