import { $inject } from "alepha";

import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "../schemas/DashboardMetricCatalog.ts";
import { DashboardAttentionRegistry } from "./DashboardAttentionRegistry.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * "Needs you" (#Q2656): one list that every module contributes to.
 *
 * Each card's project asks every source its capabilities allow, merges what
 * they answer by weight, keeps the eight heaviest (one row per thing: a quest
 * both held and stale appears once, at its heavier reading) and adds a
 * "N more" row per source that had more than it showed. Hidden at zero:
 * nothing anywhere answers `empty`.
 *
 * It runs inside the board's one resolve like every metric (folio #1057);
 * the capability rows are one batched read for every card.
 */
export class NeedsYouMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);
  protected readonly attention = $inject(DashboardAttentionRegistry);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly catalog = $inject(DashboardMetricCatalog);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "needsYou";

  /**
   * How many rows the merged list shows.
   */
  protected readonly cap = 8;

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();
    const capabilities = await this.security.capabilityRowsForProjects([
      ...new Set(cards.flatMap((entry) => entry.scope.projectIds)),
    ]);

    for (const entry of cards) {
      const project = entry.scope.projects[0];
      if (!project) {
        out.set(entry.card.id, { empty: "noData", detail: {} });
        continue;
      }
      const sources = this.attention.for(capabilities.get(project.id) ?? []);
      const answers = await Promise.all(
        sources.map(async (source) => ({
          source,
          answer: await source.read(project, {
            viewerId: entry.scope.viewerId,
            windowDays: entry.windowDays,
          }),
        })),
      );

      // One row per thing, at its heaviest reading.
      const byId = new Map<
        string,
        {
          weight: number;
          row: (typeof answers)[number]["answer"]["items"][number]["row"];
          source: string;
        }
      >();
      for (const { source, answer } of answers) {
        for (const item of answer.items) {
          const key = item.row.id ?? `${source.key}:${item.row.title}`;
          const held = byId.get(key);
          if (!held || held.weight < item.weight) {
            byId.set(key, { ...item, source: source.key });
          }
        }
      }
      const merged = [...byId.values()].sort((a, b) => b.weight - a.weight);
      const shown = merged.slice(0, this.cap);
      const total = answers.reduce((sum, it) => sum + it.answer.total, 0);

      // "N more" per source that had more than made the list.
      const more = answers
        .map(({ source, answer }) => ({
          source,
          answer,
          rest:
            answer.total -
            shown.filter((it) => it.source === source.key).length,
        }))
        .filter((it) => it.rest > 0);

      out.set(entry.card.id, {
        ...(total === 0 ? { empty: "noData" as const } : {}),
        value: total,
        rows: [
          ...shown.map((it) => it.row),
          ...more.map((it) => ({
            title: it.source.key,
            badge: "more",
            value: it.rest,
            ...(it.answer.link ? { link: it.answer.link } : {}),
          })),
        ],
        detail: {},
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: project.slug,
        }),
      });
    }

    return out;
  }
}
