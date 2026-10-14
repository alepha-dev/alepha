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

import type { Release } from "../entities/releases.ts";
import { DefaultReleaseService } from "./DefaultReleaseService.ts";
import { ReleaseContentService } from "./ReleaseContentService.ts";

/**
 * The release the project is working towards, and whether it will make it
 * (#Q2654): the headline of the computed board.
 *
 * The DEFAULT release when one is open, else the nearest open release with
 * work left (earliest target date first, then the newest). Done, in
 * progress and to do as segments, counted by `ReleaseContentService` like
 * every other release figure. With a target date, the pace: what is left
 * over the days left, against what the window's completions averaged.
 *
 * An open release with every quest done reports `readyToPublish`, as the
 * release card does (#Q2649).
 */
export class ReleaseOutlookMetric implements DashboardMetricResolver {
  protected readonly dashboard = $inject(DashboardMetricRegistry);

  constructor() {
    this.dashboard.register(this);
  }

  readonly metric = "releaseOutlook";

  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly contents = $inject(ReleaseContentService);
  protected readonly defaults = $inject(DefaultReleaseService);
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
      const release = await this.pick(project.id);
      if (!release) {
        out.set(entry.card.id, { empty: "noRelease", detail: {} });
        continue;
      }
      const held = (
        await this.contents.contentsOfMany(project.id, [release])
      ).get(release.id);
      const progress = this.contents.progressOf(release, held);
      const todo = Math.max(
        0,
        progress.total - progress.completed - progress.inProgress,
      );
      const readyToPublish =
        progress.total > 0 && progress.completed === progress.total;
      const now = this.dateTime.nowMillis();
      const since = now - entry.windowDays * 86_400_000;
      const recent = (held?.quests ?? []).filter(
        (quest) =>
          quest.completedAt &&
          this.dateTime.of(quest.completedAt).valueOf() >= since,
      ).length;
      const daysLeft = release.targetDate
        ? Math.max(
            0,
            Math.ceil(
              (this.dateTime.of(release.targetDate).valueOf() - now) /
                86_400_000,
            ),
          )
        : undefined;
      const left = progress.total - progress.completed;
      out.set(entry.card.id, {
        ...(progress.total === 0 ? { empty: "noRelease" as const } : {}),
        value:
          progress.total > 0 && !readyToPublish
            ? Math.round((progress.completed / progress.total) * 100)
            : undefined,
        segments: [
          { label: "done", value: progress.completed, state: "ok" },
          { label: "inProgress", value: progress.inProgress, state: "accent" },
          { label: "todo", value: todo, state: "neutral" },
        ],
        detail: {
          tag: release.tag ?? release.title,
          completed: progress.completed,
          total: progress.total,
          readyToPublish,
          ...(daysLeft === undefined
            ? {}
            : {
                daysLeft,
                // Per day, to one decimal: what is left over the days left,
                // and what the window's completions averaged.
                neededPerDay:
                  Math.round((left / Math.max(1, daysLeft)) * 10) / 10,
                doingPerDay: Math.round((recent / entry.windowDays) * 10) / 10,
              }),
        },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: project.slug,
          releaseTag: release.tag,
        }),
      });
    }
    return out;
  }

  /**
   * The default release when it is open, else the nearest open one with work
   * left: earliest target date first, undated last, then the newest.
   */
  protected async pick(projectId: number): Promise<Release | undefined> {
    const chosen = await this.defaults.openDefault(projectId);
    if (chosen) return chosen;
    const open = (await this.contents.openProgressOf(projectId))
      .filter((it) => it.total > it.completed)
      .map((it) => it.release);
    const at = (release: Release) =>
      release.targetDate
        ? this.dateTime.of(release.targetDate).valueOf()
        : Number.POSITIVE_INFINITY;
    return open.sort((a, b) => at(a) - at(b) || b.number - a.number)[0];
  }
}
