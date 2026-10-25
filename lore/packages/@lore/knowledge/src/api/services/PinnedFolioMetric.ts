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
import { $repository } from "alepha/orm";

import { type Folio, folios } from "../entities/folios.ts";

/**
 * The project's first pinned folio, as a note (#Q2658): its summary, or its
 * opening paragraph when it has none, linking to it. Lanthanides pins
 * "Accueil".
 */
export class PinnedFolioMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "pinnedFolio";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly folios = $repository(folios);

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
      const [pinned] = await this.folios.findMany({
        where: { projectId: { eq: project.id }, pinned: { eq: true } },
        orderBy: [{ column: "shortId", direction: "asc" }],
        limit: 1,
      });
      if (!pinned) {
        out.set(entry.card.id, { empty: "noFolio", detail: {} });
        continue;
      }
      out.set(entry.card.id, {
        rows: [this.row(pinned, slug)],
        detail: {
          title: pinned.title,
          markdown: pinned.summary || this.opening(pinned.content),
        },
        link: this.row(pinned, slug).link,
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

  /**
   * The first paragraph of a folio that is prose, headings skipped.
   */
  protected opening(content: string): string {
    const paragraph = content
      .split(/\n\s*\n/)
      .map((it) => it.trim())
      .find((it) => it.length > 0 && !it.startsWith("#"));
    return (paragraph ?? "").slice(0, 600);
  }
}
