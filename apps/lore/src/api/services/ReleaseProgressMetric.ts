import { $inject } from "alepha";

import type { Release } from "../entities/releases.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import { DashboardMetricCatalog } from "./DashboardMetricCatalog.ts";
import type {
  DashboardMetricResolver,
  DashboardResolvable,
} from "./DashboardMetricResolver.ts";
import {
  type ReleaseContents,
  ReleaseContentService,
} from "./ReleaseContentService.ts";

/**
 * How far along one release is: the number that answers "are we going to make
 * the demo".
 *
 * ## The buckets come from `ReleaseContentService.progressOf`, and nothing else
 *
 * That method exists precisely to stop a second count. A release is mostly a
 * set of EPICS, so a direct `releaseId` count reports 0/0 for the normal case
 * and disagrees with the changelog beside it. It also branches on
 * `releasedAt`, reading the frozen columns for a published release and
 * counting live only for an open one - so a quest completed a month after
 * `0.28.0` shipped never rewrites what `0.28.0` shipped.
 *
 * ## ⚠️ The subtraction is a NO-OP here, and applying it would be a bug
 *
 * Both progress cards show `completed / (total - shelved)` (A3 of epic #E46).
 * On the EPIC side that means subtracting, because `EpicProgressService` puts
 * shelved quests inside `total`. `progressOf` already counts them OUTSIDE its
 * `total` - its own comment says so and says it is NOT the same denominator -
 * so the arithmetic here is `completed / total` and that IS the ruled figure.
 * Subtracting again would divide by a number smaller than the work, and the
 * card would read over 100% on any release with a declined quest.
 *
 * ## A published release
 *
 * The record is frozen and the card is finished by definition (D3 of the
 * epic). It stays, says "published", and repoints only through the Edit item
 * the card menu already has: no auto-repoint and no self-deletion, because a
 * card is somebody's configuration.
 *
 * ## It names ONE release, chosen when the card is added
 *
 * Membership is an assignment, not a time window: nothing closes on a timer
 * and many releases are open at once, so "the current release" is not a thing
 * this card can infer. Epic #E48 adds `releases.defaultSince`, which would
 * make it inferable; A4 ruled that this card does not wait for it, and a
 * "follow the default release" option later throws none of this away.
 */
export class ReleaseProgressMetric implements DashboardMetricResolver {
  readonly metric = "releaseProgress";

  protected readonly contents = $inject(ReleaseContentService);
  protected readonly catalog = $inject(DashboardMetricCatalog);

  async resolveAll(
    cards: DashboardResolvable[],
  ): Promise<
    Map<number, Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">>
  > {
    const out = new Map<
      number,
      Omit<DashboardCardValue, "cardId" | "ok" | "scopeNames">
    >();

    // ⚠️ Only the OPEN releases are read. `progressOf` answers a published one
    // entirely from its own frozen columns, so fetching its contents would be
    // a query whose result is discarded - and, worse, an invitation for a
    // later edit to start counting it live.
    const open = cards
      .map((entry) => entry.scope.release)
      .filter(
        (release): release is Release => !!release && !release.releasedAt,
      );

    // Grouped by project, because `contentsOfMany` takes one. A project board
    // has exactly one, so this is one call in practice and correct anyway if a
    // board ever spans more.
    const byProject = new Map<number, Release[]>();
    for (const release of open) {
      const list = byProject.get(release.projectId) ?? [];
      if (!list.some((it) => it.id === release.id)) list.push(release);
      byProject.set(release.projectId, list);
    }

    const contents = new Map<number, ReleaseContents>();
    for (const [projectId, releases] of byProject) {
      const answered = await this.contents.contentsOfMany(projectId, releases);
      for (const [releaseId, value] of answered) {
        contents.set(releaseId, value);
      }
    }

    for (const entry of cards) {
      const release = entry.scope.release;
      if (!release) {
        // The project turned `work.releases` off after the card was added.
        // Zero-ish rather than unreadable, the same answer the epic card gives.
        out.set(entry.card.id, { detail: { hidden: true } });
        continue;
      }

      const progress = this.contents.progressOf(
        release,
        contents.get(release.id),
      );

      // ⚠️ NO subtraction. See the class doc: `shelved` is already outside
      // `total` on this side.
      const denominator = progress.total;
      const open = Math.max(
        0,
        progress.total - progress.completed - progress.inProgress,
      );

      out.set(entry.card.id, {
        value:
          denominator > 0
            ? Math.round((progress.completed / denominator) * 100)
            : undefined,
        detail: {
          completed: progress.completed,
          inProgress: progress.inProgress,
          shelved: progress.shelved,
          total: progress.total,
          open,
          denominator,
          published: !!release.releasedAt,
          releasedAt: release.releasedAt ?? null,
        },
        link: this.catalog.get(this.metric).link(entry.card.scope, {
          projectSlug: entry.scope.projects[0]?.slug,
          // ⚠️ The TAG, which is what `/releases/:releaseTag` takes - the
          // route comment says why: `/alepha/releases/0.28.0` is what the URL
          // is for. The scope stores `releaseId`.
          releaseTag: release.tag,
        }),
      });
    }

    return out;
  }
}
