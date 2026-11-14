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

import { folioDirectories } from "../entities/folioDirectories.ts";
import { type Folio, folios } from "../entities/folios.ts";

/**
 * Folios per top-level directory, as stacked segments (#Q2658). A folio in a
 * nested directory counts toward the top-level one above it; a folio at the
 * root counts as `/`.
 */
export class FoliosByDirectoryMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "foliosByDirectory";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly folios = $repository(folios);
  protected readonly directories = $repository(folioDirectories);

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
      const [all, dirs] = await Promise.all([
        this.folios.findMany({
          where: { projectId: { eq: project.id } },
          columns: ["id", "directoryId"],
        }),
        this.directories.findMany({ where: { projectId: { eq: project.id } } }),
      ]);
      if (all.length === 0) {
        out.set(entry.card.id, { empty: "noFolio", detail: {} });
        continue;
      }
      const byId = new Map(dirs.map((dir) => [dir.id, dir]));
      const top = (id: string | undefined): string => {
        let current = id ? byId.get(id) : undefined;
        // Bounded by the directory count: a cycle can never spin forever.
        for (let hops = 0; current?.parentId && hops < dirs.length; hops += 1) {
          current = byId.get(current.parentId) ?? current;
          if (!current.parentId) break;
        }
        return current?.name ?? "/";
      };
      const counts = new Map<string, number>();
      for (const folio of all) {
        const name = top(folio.directoryId);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      out.set(entry.card.id, {
        segments: [...counts]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([label, value]) => ({ label, value })),
        detail: { total: all.length },
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
