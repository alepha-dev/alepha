import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import type { Epic } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";
import type { ReleaseCascade } from "../schemas/releaseCascadeSchema.ts";
import { BoundParameters } from "./BoundParameters.ts";
import { ReleaseAttachmentService } from "./ReleaseAttachmentService.ts";

/**
 * An epic's release, carried down to the quests the epic holds.
 *
 * ## Why this exists
 *
 * Setting a release on an epic used to change one row. Its quests kept
 * whatever they had, so the two sides drifted apart with nothing saying so,
 * and the drift is only visible by reading both. On 2026-09-08 epic #E45 sat
 * outside `0.29.0` while all ten of its quests were in it, which made the
 * release read 224/234 with ten open quests an hour before it was due to be
 * dispatched. `publishRelease` calls `assertOpen` and no completeness check,
 * then FREEZES the counts - so that release would have been wrong forever,
 * and `release_reopen` the only way back.
 *
 * ## The rule: the cascade is a DEFAULT, not an override
 *
 * The epic's release fills in for every quest that has not said otherwise. A
 * quest that names a release of its own keeps it.
 *
 * ⚠️ That is deliberately narrower than "the epic and its quests never
 * disagree", and the reason is a decision taken elsewhere and covered by a
 * test: `ReleaseContentService` supports a quest whose epic ships in `0.28.0`
 * while the quest itself ships in `1.0.0` - "a real state, not an error" -
 * and puts it in the release it NAMES, so it never sits in two denominators
 * at once. See `release-contents.spec.ts`, "puts a cross-release quest in the
 * release it names". A cascade that overwrote would delete that capability
 * silently, one epic update at a time. So the disagreement this service ends
 * is the accidental one, and the deliberate one survives - counted in `kept`
 * rather than left invisible.
 *
 * ## The four decisions
 *
 * Each had a defensible other answer. They are written here rather than in a
 * commit message because the next person to touch this file needs them.
 *
 * **1. A quest naming a DIFFERENT release keeps it**, and is counted. Not
 * overwritten (that deletes the cross-release state above), not refused (that
 * makes the operation unavailable in the situation it was written for, and
 * the caller's next move is to do it by hand anyway).
 *
 * **2. Clearing an epic's release clears its quests' too.** A cascade that
 * only ever adds leaves exactly the same drift one release later. The rule is
 * one rule in both directions - which is why `toQuests` takes the epic's
 * PREVIOUS release as well as its next one: a quest sitting in the previous
 * one was following the epic and follows it out, while a quest sitting in a
 * third release said something of its own and keeps saying it. Without the
 * previous, "in a different release" would be true of a follower too, and
 * every epic that changed release would strand its own quests.
 *
 * **3. The published guard is honoured through the same service, and
 * refusals are reported.** The followers go through
 * `ReleaseAttachmentService.resolve`, the same call `updateQuestById` makes,
 * so no path here can be the one that gets a published release wrong. D1 has
 * no transaction here, so partial application is the only outcome available;
 * what is not available is reporting it as a clean success.
 *
 * ⚠️ **Once per distinct current release, not once per quest.** `resolve`
 * takes only `(projectId, current, next)`, and across a follower set `next`
 * is one value and `current` is at most two - `null`, or the epic's previous
 * release. So a per-quest call asked the same question up to twenty-one
 * times: at twenty quests the update cost 42 `select from releases` against
 * 20 `update quests`, 56% of the whole request spent re-reading two rows
 * (#Q2146, measured on the node:sqlite driver, where statements equal D1
 * round trips one for one).
 *
 * This paragraph used to argue the opposite - that re-reading per quest was
 * what bought the guarantee, and an epic's quest set was small enough for the
 * saving to be imaginary. The guarantee is that the rule is stated in ONE
 * place, and grouping keeps that: `resolve` is still the only thing that
 * decides, and it is still the same call the single-quest path makes. What
 * changed is how many times it is asked, not who answers.
 *
 * ⚠️ Where a refusal actually comes from is worth knowing, because the
 * obvious answer is wrong. `toQuests` cannot produce one: `updateEpic` has
 * already resolved the epic's own move, which proves both the previous and
 * the next release open, and a follower is by definition in one of those two
 * or in none. The reachable case is `toQuest` - a quest joining an epic whose
 * release has since been PUBLISHED, which is legal because the epic can still
 * be `planned` and `publishRelease` runs no completeness check. So the guard
 * here is not decoration, and it is also not the common path.
 *
 * **5. Beginning an epic is a release move like any other.** An epic that
 * names no release takes the project's DEFAULT one on the `planned -> active`
 * edge (#E48), and that release reaches its quests through this service, on
 * that edge, exactly as it would through `updateEpic`. One shape for "an epic
 * has a release": the epic's row and its quests' rows both name it.
 *
 * ⚠️ `EpicController.setEpicStatus`'s doc says it must not write to any quest
 * row. That rule is about a quest's STATUS, and it is untouched: activating an
 * epic still releases its quests because `EpicVisibilityService` stops
 * matching them. This writes `releaseId` and nothing else. Without this
 * paragraph the next reader finds an epic activation writing to quests and
 * deletes it to restore a rule whose point they have lost.
 *
 * ⚠️ That call passes `previous = null`, which is what makes the follower test
 * select the quests naming nothing and leave a quest given its own release
 * during planning in `kept`.
 *
 * **4. A quest filed into an epic that already has a release inherits it**,
 * when it is in no release. Otherwise the drift returns the first time
 * somebody adds an eleventh quest, which is how the original incident
 * happened. `EpicController.attachQuest` is the single choke point - the web
 * app, `quest_create` with `epic_number` and `quest_update` with
 * `epic_number` all reach it - so inheritance is one call there rather than
 * three.
 */
export class ReleaseCascadeService {
  quests = $repository(quests);
  attachment = $inject(ReleaseAttachmentService);
  bound = $inject(BoundParameters);

  /**
   * Write `next` onto every quest the epic holds that was following it.
   *
   * `previous` is the epic's release before this update, and is what tells a
   * follower apart from a quest that named a release of its own - see
   * decision 2 above. Call this only when the two differ: a no-op cascade
   * still reads the epic's whole quest set.
   */
  async toQuests(
    epic: Epic,
    previous: number | null,
    next: number | null,
  ): Promise<ReleaseCascade> {
    const held = await this.quests.findMany({
      where: { epicId: { eq: epic.id } },
    });
    return await this.apply(epic.projectId, held, next, (quest) => {
      const current = quest.releaseId ?? null;
      return current === null || current === previous;
    });
  }

  /**
   * The same write for one quest joining an epic that already has a release.
   *
   * Returns `undefined` when there is nothing to say - the epic is in no
   * release, or the quest is already in that one - so a caller can skip the
   * report rather than send three zeroes.
   */
  async toQuest(epic: Epic, quest: Quest): Promise<ReleaseCascade | undefined> {
    const next = epic.releaseId ?? null;
    if (next === null || (quest.releaseId ?? null) === next) {
      return undefined;
    }
    // A joining quest has no previous epic release to have been following, so
    // the only thing that inherits is a quest in no release at all.
    return await this.apply(
      epic.projectId,
      [quest],
      next,
      (candidate) => (candidate.releaseId ?? null) === null,
    );
  }

  /**
   * The write, grouped so its cost does not grow with the epic.
   *
   * ⚠️ **Grouped by the follower's CURRENT release**, which is the only input
   * to `resolve` that varies across a follower set - `next` is one value for
   * all of them. `toQuests` admits two groups at most (a quest in no release,
   * and one in the epic's previous release) and `toQuest` exactly one, so the
   * release reads are bounded by the RULE rather than by the quest count.
   *
   * ⚠️ **A refusal marks its whole group.** One `resolve` now answers for
   * several quests, and they are identical questions - same project, same
   * `current`, same `next` - so an answer that refuses one refuses all of
   * them, and reporting only the first would under-report the same event.
   * The reachable refusal is `toQuest`'s single quest anyway; `toQuests`
   * cannot produce one, for the reason decision 3 gives.
   *
   * ⚠️ **`inArray` goes through {@link BoundParameters}**, so this is one
   * `UPDATE` per 90 followers rather than strictly one: D1 binds at most 100
   * parameters and an unbounded list is a cliff, not an optimisation. Flat
   * for every epic anyone has, and O(N/90) rather than O(N) beyond that.
   */
  protected async apply(
    projectId: number,
    held: Quest[],
    next: number | null,
    follows: (quest: Quest) => boolean,
  ): Promise<ReleaseCascade> {
    const cascade: ReleaseCascade = { moved: 0, kept: 0, refused: [] };

    const groups = new Map<number | null, Quest[]>();
    for (const quest of held) {
      const current = quest.releaseId ?? null;
      if (current === next) {
        continue;
      }
      if (!follows(quest)) {
        cascade.kept += 1;
        continue;
      }
      const group = groups.get(current);
      if (group) group.push(quest);
      else groups.set(current, [quest]);
    }

    for (const [current, followers] of groups) {
      try {
        const resolved = await this.attachment.resolve(
          projectId,
          current ?? undefined,
          next,
        );
        // `updateMany` returns the ids it wrote, so `moved` stays a count of
        // rows that actually changed rather than of rows we asked about.
        const moved = await this.bound.collect(
          followers.map((quest) => quest.id),
          (batch) =>
            this.quests.updateMany(
              { id: { inArray: batch } },
              { releaseId: resolved },
            ),
        );
        cascade.moved += moved.length;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        for (const quest of followers) {
          cascade.refused.push({ shortId: quest.shortId, reason });
        }
      }
    }

    return cascade;
  }
}
