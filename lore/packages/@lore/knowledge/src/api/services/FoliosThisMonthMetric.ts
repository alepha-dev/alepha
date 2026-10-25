import {
  DashboardMetricRegistry,
  type DashboardMetricResolver,
  type DashboardResolvable,
} from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
} from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { type Folio, folios } from "../entities/folios.ts";

/**
 * Folios created in the board's window (#Q2658): where decisions land.
 */
export class FoliosThisMonthMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "foliosThisMonth";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly folios = $repository(folios);
  protected readonly dateTime = $inject(DateTimeProvider);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();
    for (const entry of cards) {
      const project = entry.scope.projects[0];
      if (!project) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const slug = project.slug ?? "";
      const since = this.dateTime
        .now()
        .subtract(entry.windowDays, "day")
        .toISOString();
      const made = await this.folios.findMany({
        where: { projectId: { eq: project.id }, createdAt: { gte: since } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: 8,
      });
      out.set(entry.card.id, {
        ...(made.length === 0 ? { empty: "noFolio" as const } : {}),
        value: made.length,
        rows: made.map((folio) => ({
          ...this.row(folio, slug),
          at: folio.createdAt,
        })),
        detail: {},
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: slug,
        }),
      });
    }
    return out;
  }

  /**
   * A folio as a row: its typed reference and title, linked to it.
   */
  protected row(
    folio: Folio,
    projectSlug: string,
  ): NonNullable<DashboardCardValue["rows"]>[number] {
    return {
      id: `F${folio.shortId}`,
      title: folio.title,
      link: {
        route: "projectFoliosFolio",
        params: { projectSlug, shortId: String(folio.shortId) },
      },
    };
  }
}
