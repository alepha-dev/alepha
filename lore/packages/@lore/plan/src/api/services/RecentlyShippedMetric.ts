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

import { type Quest, quests } from "../entities/quests.ts";
import { EpicVisibilityService } from "./EpicVisibilityService.ts";

/**
 * The last completed quests, with their completion message (#Q2655). Also
 * the body of the dormant board's line (#Q2662).
 */
export class RecentlyShippedMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "recentlyShipped";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly quests = $repository(quests);
  protected readonly epicVisibility = $inject(EpicVisibilityService);
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
      const done = {
        projectId: { eq: project.id },
        completedAt: { isNotNull: true },
      };
      const [shipped, total] = await Promise.all([
        this.quests.findMany({
          where: done,
          orderBy: [{ column: "completedAt", direction: "desc" }],
          limit: 8,
        }),
        // Every completion, for "14 quests shipped" (#Q2662).
        this.quests.count(done),
      ]);
      out.set(entry.card.id, {
        ...(shipped.length === 0 ? { empty: "noActivity" as const } : {}),
        value: total,
        rows: shipped.map((quest) => ({
          ...this.row(quest, slug),
          meta: undefined,
          at: quest.completedAt,
          excerpt: this.excerpt(quest.completionMessage),
          state: "ok" as const,
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
   * A quest as a row: its typed reference, title and area, linked to it.
   */
  protected row(
    quest: Quest,
    projectSlug: string,
  ): NonNullable<DashboardCardValue["rows"]>[number] {
    return {
      id: `Q${quest.shortId}`,
      title: quest.title,
      meta: quest.area,
      link: {
        route: "projectQuest",
        params: { projectSlug, shortId: String(quest.shortId) },
      },
    };
  }

  /**
   * A completion message's first line, short enough for a feed row.
   */
  protected excerpt(message: string | undefined): string | undefined {
    const line = message
      ?.split("\n")
      .map((it) => it.trim())
      .find((it) => it.length > 0);
    if (!line) return undefined;
    return line.length > 140 ? `${line.slice(0, 139)}…` : line;
  }
}
