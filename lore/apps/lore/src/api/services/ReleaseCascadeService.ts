import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import type { Epic } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";
import type { ReleaseCascade } from "../schemas/releaseCascadeSchema.ts";
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
 * **3. The published guard is honoured per quest, and refusals are
 * reported.** Each quest goes through `ReleaseAttachmentService.resolve`, the
 * same call `updateQuestById` makes, so no path here can be the one that gets
 * a published release wrong. D1 has no transaction here, so partial
 * application is the only outcome available; what is not available is
 * reporting it as a clean success.
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

  protected async apply(
    projectId: number,
    held: Quest[],
    next: number | null,
    follows: (quest: Quest) => boolean,
  ): Promise<ReleaseCascade> {
    const cascade: ReleaseCascade = { moved: 0, kept: 0, refused: [] };

    for (const quest of held) {
      if ((quest.releaseId ?? null) === next) {
        continue;
      }
      if (!follows(quest)) {
        cascade.kept += 1;
        continue;
      }
      try {
        // The same call `updateQuestById` makes, so this path cannot be the
        // one that gets a published release wrong. It re-reads the release
        // rows per quest, which is what buys the guarantee that the rule is
        // stated once; an epic's quest set is small enough that caching it
        // would trade a real invariant for an imaginary saving.
        const resolved = await this.attachment.resolve(
          projectId,
          quest.releaseId,
          next,
        );
        await this.quests.updateById(quest.id, { releaseId: resolved });
        cascade.moved += 1;
      } catch (error) {
        cascade.refused.push({
          shortId: quest.shortId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return cascade;
  }
}
