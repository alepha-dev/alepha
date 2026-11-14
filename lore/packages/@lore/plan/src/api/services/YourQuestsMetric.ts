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
 * The reader's own open quests (#Q2655), on a board every member shares.
 *
 * Scoped to the `viewer`: whoever reads the board, resolved on the request,
 * never stored. A held quest says so; a quest past its due date too.
 */
export class YourQuestsMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "yourQuests";

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
      const where = this.quests.createQueryWhere();
      where.projectId = { eq: project.id };
      where.shelvedAt = { isNull: true };
      where.completedAt = { isNull: true };
      await this.epicVisibility.applyBacklogGate(where, project.id);
      if (!entry.scope.viewerId) {
        out.set(entry.card.id, { empty: "noQuests", detail: {} });
        continue;
      }
      where.acceptedBy = { eq: entry.scope.viewerId };
      const mine = await this.quests.findMany({
        where,
        orderBy: [{ column: "updatedAt", direction: "desc" }],
        limit: 8,
      });
      const now = this.dateTime.nowISOString();
      out.set(entry.card.id, {
        ...(mine.length === 0 ? { empty: "noQuests" as const } : {}),
        value: mine.length,
        rows: mine.map((quest) => ({
          ...this.row(quest, slug),
          ...(quest.heldAt
            ? { badge: "held", state: "warn" as const }
            : quest.dueAt && quest.dueAt < now
              ? { badge: "overdue", state: "bad" as const }
              : { state: "accent" as const }),
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
}
