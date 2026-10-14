import {
  DashboardAttentionRegistry,
  type DashboardAttentionItem,
  type DashboardAttentionItems,
} from "@lore/core/api";
import type { Project } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { feedback } from "../entities/feedback.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { EpicVisibilityService } from "./EpicVisibilityService.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";

/**
 * Work's contributions to "needs you" (#Q2656), registered on core's
 * `DashboardAttentionRegistry`.
 *
 * - `quests`: overdue, held, stale and unassigned quests. Stale and
 *   unassigned come from the Reports `attention` counts and `aging` list
 *   (`ProjectReportsService`), so the board and Reports agree on what is
 *   stale. Unassigned shows only its high-priority quests by name: the whole
 *   backlog is unassigned by nature, and listing it is not "needs you".
 * - `feedback`: untriaged feedback, under the Support capability.
 */
export class WorkAttentionSources {
  protected readonly attention = $inject(DashboardAttentionRegistry);
  protected readonly quests = $repository(quests);
  protected readonly feedback = $repository(feedback);
  protected readonly reports = $inject(ProjectReportsService);
  protected readonly epicVisibility = $inject(EpicVisibilityService);
  protected readonly dateTime = $inject(DateTimeProvider);

  constructor() {
    this.attention.register({
      key: "quests",
      needs: { capability: "work" },
      read: (project) => this.questsOf(project),
    });
    this.attention.register({
      key: "feedback",
      needs: { capability: "support" },
      read: (project) => this.feedbackOf(project),
    });
  }

  protected async questsOf(project: Project): Promise<DashboardAttentionItems> {
    const slug = project.slug ?? "";
    const now = this.dateTime.nowISOString();
    const where = this.quests.createQueryWhere();
    where.projectId = { eq: project.id };
    where.shelvedAt = { isNull: true };
    where.completedAt = { isNull: true };
    where.or = [{ heldAt: { isNotNull: true } }, { dueAt: { lt: now } }];
    await this.epicVisibility.applyBacklogGate(where, project.id);

    const [flagged, overview, report] = await Promise.all([
      this.quests.findMany({ where, limit: 20 }),
      this.reports.overview(project.id),
      this.reports.questsReport(project.id),
    ]);
    const unassigned = await this.quests.findMany({
      where: {
        projectId: { eq: project.id },
        shelvedAt: { isNull: true },
        completedAt: { isNull: true },
        acceptedAt: { isNull: true },
        priority: { eq: "high" },
      },
      limit: 3,
    });

    const items: DashboardAttentionItem[] = [];
    for (const quest of flagged) {
      const overdue = !!quest.dueAt && quest.dueAt < now;
      items.push({
        weight: overdue ? 40 : 30,
        row: {
          ...this.row(quest, slug),
          badge: overdue ? "overdue" : "held",
          state: overdue ? "bad" : "warn",
        },
      });
    }
    for (const aged of report.aging.filter((it) => it.ageDays >= 14)) {
      items.push({
        // Older is heavier, but never above a hold.
        weight: 20 + Math.min(aged.ageDays, 90) / 10,
        row: {
          id: `Q${aged.shortId}`,
          title: aged.title,
          badge: "stale",
          state: "warn",
          link: {
            route: "projectQuest",
            params: { projectSlug: slug, shortId: String(aged.shortId) },
          },
        },
      });
    }
    for (const quest of unassigned) {
      items.push({
        weight: 10,
        row: {
          ...this.row(quest, slug),
          badge: "unassigned",
          state: "neutral",
        },
      });
    }

    const overdueOrHeld = flagged.length;
    return {
      items,
      total:
        overdueOrHeld +
        overview.attention.staleQuests +
        Math.min(unassigned.length, overview.attention.unassignedQuests),
      link: { route: "projectQuests", params: { projectSlug: slug } },
    };
  }

  protected async feedbackOf(
    project: Project,
  ): Promise<DashboardAttentionItems> {
    const where = {
      projectId: { eq: project.id },
      status: { eq: "pending" as const },
    };
    const [pending, total] = await Promise.all([
      this.feedback.findMany({
        where,
        orderBy: [{ column: "createdAt", direction: "asc" }],
        limit: 8,
      }),
      this.feedback.count(where),
    ]);
    const slug = project.slug ?? "";
    return {
      items: pending.map((item) => ({
        weight: 15,
        row: {
          id: `P${item.shortId}`,
          title: item.title,
          badge: "untriaged",
          state: "accent" as const,
          link: { route: "projectFeedback", params: { projectSlug: slug } },
        },
      })),
      total,
      link: { route: "projectFeedback", params: { projectSlug: slug } },
    };
  }

  protected row(quest: Quest, projectSlug: string) {
    return {
      id: `Q${quest.shortId}`,
      title: quest.title,
      link: {
        route: "projectQuest",
        params: { projectSlug, shortId: String(quest.shortId) },
      },
    };
  }
}
