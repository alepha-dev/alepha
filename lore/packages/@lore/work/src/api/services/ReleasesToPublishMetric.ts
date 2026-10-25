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

import { ReleaseContentService } from "./ReleaseContentService.ts";

/**
 * Open releases whose every quest is done: shipped work nobody has published
 * yet (#Q2654). Club had three on 2026-10-14, Lore one (folio #F1364).
 *
 * From `ReleaseContentService.openProgressOf`, the same counts the
 * orientation index reads.
 */
export class ReleasesToPublishMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "releasesToPublish";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly contents = $inject(ReleaseContentService);

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
      const ready = (await this.contents.openProgressOf(project.id)).filter(
        (it) => it.total > 0 && it.completed === it.total,
      );
      out.set(entry.card.id, {
        ...(ready.length === 0 ? { empty: "noRelease" as const } : {}),
        value: ready.length,
        rows: ready.map(({ release, total }) => ({
          id: release.tag ?? `R${release.number}`,
          title: release.title,
          value: total,
          badge: "readyToPublish",
          state: "ok" as const,
          ...(release.tag
            ? {
                link: {
                  route: "projectRelease",
                  params: {
                    // Every project carries a slug; the column is optional only in its schema.
                    projectSlug: project.slug ?? "",
                    releaseTag: release.tag,
                  },
                },
              }
            : {}),
        })),
        detail: {},
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: project.slug,
        }),
      });
    }
    return out;
  }
}
