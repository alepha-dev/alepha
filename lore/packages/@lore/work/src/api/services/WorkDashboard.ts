import {
  DashboardCardService,
  DashboardScopeService,
  DashboardSlotRegistry,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { epics } from "../entities/epics.ts";
import { releases } from "../entities/releases.ts";

/**
 * Work's part of the dashboard, registered on core (#E75, #Q2623): how a
 * card's `epic` and `release` scopes are proven, and the quests and feedback
 * cards a fresh board starts with.
 */
export class WorkDashboard {
  protected readonly scopes = $inject(DashboardScopeService);
  protected readonly cards = $inject(DashboardCardService);
  protected readonly slots = $inject(DashboardSlotRegistry);
  protected readonly epics = $repository(epics);
  protected readonly releases = $repository(releases);

  constructor() {
    this.registerSlots();
    this.cards.registerSeed({
      order: 20,
      cards: async () => [
        { metric: "activeQuests", scope: { kind: "all" as const } },
      ],
    });
    this.cards.registerSeed({
      order: 40,
      cards: async () => [
        { metric: "untriagedFeedback", scope: { kind: "all" as const } },
      ],
    });

    this.scopes.registerScope("epic", async (scope, visibleById) => {
      const epic = await this.epics.findOne({
        where: { id: { eq: scope.epicId! } },
      });
      // Two ways to fail, one answer, exactly as for an app: the epic does
      // not exist, or it belongs to a project the caller has nothing to do
      // with. "No such epic here" is true either way, and distinguishing them
      // would leak the second.
      if (!epic || !visibleById.has(epic.projectId)) {
        throw new NotFoundError("Epic not found");
      }
      return [
        {
          kind: "epic",
          id: String(epic.id),
          projectId: epic.projectId,
          name: epic.title,
          row: epic,
        },
      ];
    });

    this.scopes.registerScope("release", async (scope, visibleById) => {
      const release = await this.releases.findOne({
        where: { id: { eq: scope.releaseId! } },
      });
      if (!release || !visibleById.has(release.projectId)) {
        throw new NotFoundError("Release not found");
      }
      return [
        {
          kind: "release",
          id: String(release.id),
          projectId: release.projectId,
          // The TAG, not the title, matching how a release is named
          // everywhere else in the app and in its own URL.
          name: release.tag ?? release.title,
          row: release,
        },
      ];
    });
  }

  /**
   * Work's candidates for the computed board (#Q2652, folio #F1364).
   *
   * Needs you: held quests, then untriaged feedback, each hidden at zero
   * (the merged list of #Q2656 takes the slot's first rank). Flow: the
   * Reports tiles of #Q2653, then the open quests.
   */
  protected registerSlots(): void {
    // Headline (#Q2654): the release with work, else the releases waiting on
    // a publish, else the epic in progress, else the week's completions.
    this.slots.register({
      slot: "headline",
      rank: 10,
      metric: "releaseOutlook",
      size: 2,
    });
    this.slots.register({
      slot: "headline",
      rank: 20,
      metric: "releasesToPublish",
      size: 2,
    });
    this.slots.register({
      slot: "headline",
      rank: 30,
      metric: "epicsInFlight",
      size: 2,
    });
    this.slots.register({
      slot: "headline",
      rank: 40,
      metric: "completedThisWeek",
      size: 2,
      keep: (value) =>
        (value.value ?? 0) > 0 || Number(value.detail.lastWeek ?? 0) > 0,
    });
    // Plan: epics in flight, then draft epics, then releases to publish.
    this.slots.register({
      slot: "plan",
      rank: 10,
      metric: "epicsInFlight",
      size: 2,
      height: 2,
    });
    this.slots.register({
      slot: "plan",
      rank: 20,
      metric: "draftEpics",
      size: 2,
      height: 2,
    });
    this.slots.register({
      slot: "plan",
      rank: 30,
      metric: "releasesToPublish",
      size: 2,
      height: 2,
    });
    const above = (min: number) => (value: { value?: number }) =>
      (value.value ?? 0) >= min;

    this.slots.register({
      slot: "needsYou",
      rank: 50,
      metric: "heldQuests",
      keep: above(1),
    });
    this.slots.register({
      slot: "needsYou",
      rank: 60,
      metric: "untriagedFeedback",
      keep: above(1),
    });
    // Flow (#Q2653): board columns, then completed per week, then the
    // burn-up, each only once the window holds five completions: below that
    // a flow chart is a few dots and says nothing.
    const flowing = (value: { detail: Record<string, unknown> }) =>
      Number(value.detail.windowCompletions ?? 0) >= 5;
    this.slots.register({
      slot: "flow",
      rank: 10,
      metric: "boardColumns",
      keep: flowing,
    });
    this.slots.register({
      slot: "flow",
      rank: 20,
      metric: "completedPerWeek",
      keep: flowing,
      size: 2,
    });
    this.slots.register({
      slot: "flow",
      rank: 30,
      metric: "burnup",
      keep: flowing,
      size: 2,
    });
    this.slots.register({
      slot: "flow",
      rank: 90,
      metric: "activeQuests",
      keep: above(1),
    });
  }
}
