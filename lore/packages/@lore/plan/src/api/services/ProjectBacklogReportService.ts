import type { ReportsBacklog, ReportsQuery } from "@lore/core/schemas";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { ProjectReportsService } from "./ProjectReportsService.ts";

/**
 * The Backlog tab's report (#Q3002): the open work as it stands, in the scope
 * every report shares. All of it is a read of the open quests, so the period
 * only narrows the objectives figure.
 */
export class ProjectBacklogReportService {
  protected readonly quests = $repository(quests);
  protected readonly reports = $inject(ProjectReportsService);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * The upper edge of each age bucket, in days. The last one is open.
   */
  protected readonly ageEdges: Array<[key: string, days: number]> = [
    ["under1w", 7],
    ["under1m", 30],
    ["under3m", 90],
    ["under6m", 180],
    ["under1y", 365],
    ["over1y", Number.POSITIVE_INFINITY],
  ];

  async report(
    projectId: number,
    query: ReportsQuery,
  ): Promise<ReportsBacklog> {
    const scope = await this.reports.scopeOf(projectId, query);
    const [open, completed, shelved, total] = await Promise.all([
      this.quests.findMany({
        where: { ...scope, completedAt: { isNull: true } },
        columns: [
          "id",
          "shortId",
          "title",
          "area",
          "tags",
          "priority",
          "size",
          "createdAt",
          "acceptedAt",
          "heldAt",
          "heldBy",
          "dueAt",
          "dependsOn",
          "objectives",
          "description",
        ],
      }),
      this.quests.findMany({
        where: {
          ...scope,
          completedAt: {
            isNotNull: true,
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        },
        columns: ["objectives"],
      }),
      this.quests.count({
        projectId: { eq: projectId },
        shelvedAt: { isNotNull: true },
      }),
      this.quests.count({ projectId: { eq: projectId } }),
    ]);

    const now = this.dt.nowMillis();
    const days = (at: string) => (now - this.dt.of(at).valueOf()) / 86_400_000;
    const ref = (quest: (typeof open)[number]) => ({
      shortId: quest.shortId,
      title: quest.title,
    });
    const state = (quest: (typeof open)[number]) =>
      quest.heldAt ? "onHold" : quest.acceptedAt ? "inProgress" : "todo";

    const compose = (
      valuesOf: (quest: (typeof open)[number]) => string[],
    ): ReportsBacklog["byArea"] => {
      const rows = new Map<string, ReportsBacklog["byArea"][number]>();
      for (const quest of open) {
        for (const value of valuesOf(quest)) {
          const row = rows.get(value) ?? {
            value,
            todo: 0,
            inProgress: 0,
            onHold: 0,
          };
          row[state(quest)] += 1;
          rows.set(value, row);
        }
      }
      const size = (row: ReportsBacklog["byArea"][number]) =>
        row.todo + row.inProgress + row.onHold;
      return [...rows.values()].toSorted(
        (a, b) => size(b) - size(a) || a.value.localeCompare(b.value),
      );
    };

    const objectives = completed.flatMap((quest) => quest.objectives);

    return {
      open: open.length,
      byArea: compose((quest) => [quest.area]),
      byTag: compose((quest) => quest.tags),
      byPriority: compose((quest) => [quest.priority]),
      bySize: compose((quest) => [String(quest.size)]),
      age: this.ageEdges.map(([key, edge], index) => {
        const lower = this.ageEdges[index - 1]?.[1] ?? 0;
        return {
          key,
          count: open.filter((quest) => {
            const age = days(quest.createdAt);
            return age >= lower && age < edge;
          }).length,
        };
      }),
      blocked: this.chains(open),
      held: open
        .filter((quest) => quest.heldAt)
        .map((quest) => ({
          ...ref(quest),
          ...(quest.heldBy ? { heldBy: quest.heldBy } : {}),
          heldDays: days(quest.heldAt!),
        }))
        .toSorted((a, b) => b.heldDays - a.heldDays),
      shelvedRate: total > 0 ? (shelved / total) * 100 : 0,
      overdue: open
        .filter((quest) => quest.dueAt && days(quest.dueAt) > 0)
        .map((quest) => ({ ...ref(quest), days: days(quest.dueAt!) }))
        .toSorted((a, b) => b.days - a.days),
      dueSoon: open
        .filter((quest) => {
          const until = quest.dueAt ? -days(quest.dueAt) : -1;
          return until >= 0 && until <= 7;
        })
        .map((quest) => ({ ...ref(quest), days: -days(quest.dueAt!) }))
        .toSorted((a, b) => a.days - b.days),
      hygiene: open
        .filter(
          (quest) => quest.objectives.length === 0 || !quest.description.trim(),
        )
        .map((quest) => ({
          ...ref(quest),
          noObjectives: quest.objectives.length === 0,
          noDescription: !quest.description.trim(),
        })),
      objectives: {
        completed: objectives.filter((it) => it.completed).length,
        waived: objectives.filter((it) => it.waivedReason).length,
      },
    };
  }

  /**
   * Groups the blocked quests under the open quest at the head of their chain.
   * A predecessor that is completed or out of scope blocks nothing.
   *
   * ⚠️ `seen` guards the walk: `dependsOn` is a plain column, and nothing here
   * should loop forever on a cycle a past write left.
   */
  protected chains<
    T extends {
      id: number;
      shortId: number;
      title: string;
      dependsOn?: number;
    },
  >(open: T[]): ReportsBacklog["blocked"] {
    const byId = new Map(open.map((quest) => [quest.id, quest]));
    const groups = new Map<
      number,
      { blocker: T; blocked: T[]; depth: number }
    >();
    for (const quest of open) {
      let head = quest;
      let depth = 0;
      const seen = new Set([quest.id]);
      while (head.dependsOn !== undefined) {
        const next = byId.get(head.dependsOn);
        if (!next || seen.has(next.id)) break;
        seen.add(next.id);
        head = next;
        depth += 1;
      }
      if (depth === 0) continue;
      const group = groups.get(head.id) ?? {
        blocker: head,
        blocked: [],
        depth: 0,
      };
      group.blocked.push(quest);
      group.depth = Math.max(group.depth, depth);
      groups.set(head.id, group);
    }
    const ref = (quest: T) => ({ shortId: quest.shortId, title: quest.title });
    return [...groups.values()]
      .toSorted((a, b) => b.blocked.length - a.blocked.length)
      .map((group) => ({
        blocker: ref(group.blocker),
        blocked: group.blocked.map(ref),
        depth: group.depth,
      }));
  }
}
