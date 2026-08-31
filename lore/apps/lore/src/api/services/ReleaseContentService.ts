import type { PgQueryWhere } from "alepha/orm";
import { $repository } from "alepha/orm";

import { type Epic, epics } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";
import type { Release } from "../entities/releases.ts";

export interface ReleaseContents {
  /**
   * The epics attached to this release, in `number` order.
   */
  epics: Epic[];
  /**
   * Every quest in the release, each exactly once.
   */
  quests: Quest[];
  /**
   * The subset attached DIRECTLY, whose epic is not one of this release's.
   * The loose work: a hotfix, a doc pass, one chore.
   */
  looseQuests: Quest[];
  /**
   * In the release, but decided out of scope.
   *
   * Kept OUT of {@link quests} so no denominator counts work that was
   * declined, and returned here rather than dropped so the progress rollup
   * can still report it as its own bucket - the same four-bucket vocabulary
   * `EpicController.computeProgress` uses. A release with six shelved quests
   * should say so; folding them into the untouched remainder would read as
   * work outstanding when it is work declined.
   */
  shelvedQuests: Quest[];
}

/**
 * The single answer to "what is in this release".
 *
 * A release contains two overlapping sets: the quests attached to it directly,
 * and the quests of the epics attached to it. Four surfaces need that answer -
 * the progress rollup, the changelog, the release detail page and the roadmap
 * - and **they must never disagree**.
 *
 * That is the whole reason this is a service, and not that the query is hard.
 * The failure mode of inlining it is silent: the progress bar and the
 * changelog end up counting different things and nothing goes red.
 */
export class ReleaseContentService {
  epics = $repository(epics);
  quests = $repository(quests);

  /**
   * {@link contentsOf} for a whole list, in TWO queries rather than two per
   * release.
   *
   * The releases page renders every release a project has, and the per-release
   * form would make that 2N round-trips. Neither shape grows with the
   * project's quest count, but N is the number a list page multiplies.
   *
   * Returns a map keyed by release id. A release absent from `releases` is
   * absent from the map; every release present gets an entry, empty or not.
   */
  async contentsOfMany(
    projectId: number,
    releases: Release[],
  ): Promise<Map<number, ReleaseContents>> {
    const result = new Map<number, ReleaseContents>();
    if (releases.length === 0) return result;

    const releaseIds = releases.map((release) => release.id);
    const allEpics = await this.epics.findMany({
      where: { releaseId: { inArray: releaseIds } },
      orderBy: [{ column: "number", direction: "asc" }],
    });

    const epicsByRelease = new Map<number, Epic[]>();
    for (const epic of allEpics) {
      if (epic.releaseId == null) continue;
      const list = epicsByRelease.get(epic.releaseId) ?? [];
      list.push(epic);
      epicsByRelease.set(epic.releaseId, list);
    }

    const where: PgQueryWhere<typeof quests.schema> = {
      projectId: { eq: projectId },
    };
    const epicIds = allEpics.map((epic) => epic.id);
    // Same `inArray: []` trap as the single-release form, and one branch more
    // to get wrong: `releaseIds` is never empty here (guarded above), but
    // `epicIds` routinely is.
    if (epicIds.length > 0) {
      where.or = [
        { releaseId: { inArray: releaseIds } },
        { epicId: { inArray: epicIds }, releaseId: { isNull: true } },
      ];
    } else {
      where.releaseId = { inArray: releaseIds };
    }

    const found = await this.quests.findMany({ where });

    for (const release of releases) {
      const releaseEpics = epicsByRelease.get(release.id) ?? [];
      const epicIdSet = new Set(releaseEpics.map((epic) => epic.id));
      // The same membership rule as the single query, applied in memory:
      // named directly, or reached through one of THIS release's epics while
      // naming no release of its own.
      const mine = found.filter(
        (quest) =>
          quest.releaseId === release.id ||
          (quest.releaseId == null &&
            quest.epicId != null &&
            epicIdSet.has(quest.epicId)),
      );
      result.set(release.id, this.partition(releaseEpics, epicIdSet, mine));
    }

    return result;
  }

  async contentsOf(release: Release): Promise<ReleaseContents> {
    const attachedEpics = await this.epics.findMany({
      where: { releaseId: { eq: release.id } },
      orderBy: [{ column: "number", direction: "asc" }],
    });
    const epicIds = attachedEpics.map((epic) => epic.id);

    const where: PgQueryWhere<typeof quests.schema> = {
      projectId: { eq: release.projectId },
    };

    // ONE query, not two and a Set. `FilterOperators` is the per-COLUMN
    // operator set and has no disjunction, but `PgQueryWhereConditions` gives
    // every `where` an `and` and an `or` one level up, ANDed with the sibling
    // keys by `QueryManager.toSQL` - so the `projectId` scoping survives.
    // `EpicVisibilityService.applyBacklogGate` does the same thing today.
    //
    // ⚠️ With no epics attached the `epicId` branch is OMITTED ENTIRELY rather
    // than passed an empty array. `inArray: []` is not an empty match: `IN ()`
    // is a SQL syntax error and the sibling `notInArray: []` throws. A release
    // with no epics is the normal case, not an edge case.
    //
    // ⚠️ No `deletedAt` filter here on purpose. `Repository.withDeletedAt`
    // wraps this as `{ and: [callerWhere, { deletedAt: { isNull: true } }] }`,
    // so the `or` is nested INSIDE that `and` rather than flattened beside it,
    // and soft-deleted quests are excluded correctly. Hand-writing one would
    // be both redundant and easy to get wrong.
    if (epicIds.length > 0) {
      where.or = [
        { releaseId: { eq: release.id } },
        // ⚠️ `releaseId: { isNull: true }` is what makes an explicit
        // attachment OVERRIDE the epic's. A quest inside one of this
        // release's epics that names a DIFFERENT release belongs to the one
        // it names and is absent from this one entirely - otherwise it would
        // be counted twice across two denominators and "the progress of
        // 0.28.0" would include work that shipped in 1.0.0.
        //
        // A quest that names THIS release and sits in one of its epics is
        // caught by the first branch, so nothing is lost.
        { epicId: { inArray: epicIds }, releaseId: { isNull: true } },
      ];
    } else {
      where.releaseId = { eq: release.id };
    }

    const found = await this.quests.findMany({ where });

    return this.partition(attachedEpics, new Set(epicIds), found);
  }

  /**
   * The four progress buckets over a release's quests, from the ONE source
   * that is correct for this release's state.
   *
   * A released release reads its four FROZEN columns and is never recomputed;
   * an open one is counted live from its contents. One method branching on
   * `releasedAt`, so no caller can accidentally recompute a released one.
   *
   * That is not an optimisation. Completing a quest a month after `0.28.0`
   * shipped must not silently rewrite what `0.28.0` shipped: a released
   * release renders entirely from its own row, frozen changelog and frozen
   * counts, with no live query at all.
   *
   * ⚠️ `shelved` is counted OUTSIDE `total` - see `releases.total`. The
   * untouched remainder is `total - completed - inProgress`, and this is NOT
   * the same denominator as `EpicController.computeProgress`, which counts
   * every quest of the epic including the shelved ones.
   *
   * The three in-total buckets are disjoint, so no fifth count is needed:
   * `shelvedAt` is only ever set on a quest still in `new` status, so it
   * never coexists with `acceptedAt` or `completedAt`, and `inProgress`
   * excludes both of the others.
   *
   * ⚠️ It lives on this service rather than on `ReleaseController` (where it
   * was written) because the roadmap needs the same answer and a second copy
   * of it is exactly the silent disagreement this service exists to prevent:
   * two surfaces counting different things with nothing going red.
   */
  progressOf(
    release: Release,
    contents?: ReleaseContents,
  ): { completed: number; inProgress: number; shelved: number; total: number } {
    if (release.releasedAt) {
      return {
        completed: release.completed ?? 0,
        inProgress: release.inProgress ?? 0,
        shelved: release.shelved ?? 0,
        total: release.total ?? 0,
      };
    }

    // An open release with no contents supplied reads as empty rather than
    // throwing: the batched caller only looks up the open ones, so a missing
    // entry means "nothing in it", not "not fetched".
    const quests = contents?.quests ?? [];

    return {
      completed: quests.filter((quest) => quest.completedAt != null).length,
      inProgress: quests.filter(
        (quest) => quest.acceptedAt != null && quest.completedAt == null,
      ).length,
      shelved: contents?.shelvedQuests.length ?? 0,
      total: quests.length,
    };
  }

  /**
   * Shared by both forms above, so the single-release and batched paths can
   * never sort the same rows differently.
   */
  protected partition(
    attachedEpics: Epic[],
    epicIdSet: Set<number>,
    found: Quest[],
  ): ReleaseContents {
    // Split here rather than filtered in SQL: both halves are wanted, and one
    // query answering the whole membership question is the point of this
    // service. `quests` is what every denominator counts.
    const all = found.filter((quest) => quest.shelvedAt == null);
    const shelvedQuests = found.filter((quest) => quest.shelvedAt != null);

    // A quest reachable BOTH ways counts once, as an epic quest. The `or`
    // already returns it once; this partition is where it could be counted
    // twice, so the epic membership is tested first.
    const looseQuests = all.filter(
      (quest) => quest.epicId == null || !epicIdSet.has(quest.epicId),
    );

    return { epics: attachedEpics, quests: all, looseQuests, shelvedQuests };
  }
}
