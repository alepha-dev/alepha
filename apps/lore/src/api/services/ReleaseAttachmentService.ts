import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { type Release, releases } from "../entities/releases.ts";

/**
 * The single answer to "may this thing be put in, or taken out of, that
 * release".
 *
 * **A service rather than a line in a handler, on purpose.** The write paths
 * that attach something to a release live in three files across two modules:
 * `EpicController.updateEpic`, `QuestController.updateQuestById` and
 * `src/mcp/tools/QuestTools.ts`. (It was four until epic #E48 deleted quest
 * import, which was the fourth.) A refusal copied into each of them is the
 * shape of the 13-endpoint precondition bug `EpicVisibilityService` exists to
 * prevent: the copies drift, and the one that was forgotten is the one nobody
 * looks at.
 *
 * ⚠️ **One write path deliberately does not come through here**, and it is
 * not an oversight: `QuestController.attachToDefaultRelease` (#E48) puts a
 * finished quest in the project's default release, and must never refuse the
 * completion. This service throws by design, which is right for every caller
 * that is doing what the user asked and wrong for one doing a planning
 * convenience on the side. It reads the release row and branches instead, and
 * the guard it keeps is the same one: a published release is left alone.
 */
export class ReleaseAttachmentService {
  releases = $repository(releases);

  /**
   * Resolve the `releaseId` an update should write, refusing anything that
   * would rewrite a published release.
   *
   * Both directions are refused, and both for the same reason: a published
   * release's contents ARE its record, and its four progress counts are
   * frozen on the row (#1551). Attaching to one would make the row disagree
   * with itself; detaching from one would quietly edit what it shipped.
   * `reopenRelease` is the deliberate way past this.
   *
   * @param projectId the project the attaching entity belongs to
   * @param current   the entity's current `releaseId`, if any
   * @param next      the requested one. `null` clears the attachment.
   * @returns the value to write
   */
  async resolve(
    projectId: number,
    current: number | undefined,
    next: number | null,
  ): Promise<number | null> {
    // A no-op update must not be refused just because the release it names is
    // published: renaming an epic that shipped in `0.28.0` resends the same
    // `releaseId`, and that changes nothing about what `0.28.0` contains.
    if ((current ?? null) === next) {
      return next;
    }

    if (current != null) {
      const from = await this.releases.findById(current);
      // A dangling id is not worth refusing over: it means the release was
      // deleted, and `SET NULL` has already detached everything anyway.
      if (from) this.assertOpen(from, "detach from");
    }

    if (next != null) {
      const to = await this.releases.findById(next);
      if (!to || to.projectId !== projectId) {
        // Same message for missing and for another project's release: the
        // caller is not entitled to learn that an id exists somewhere else.
        throw new NotFoundError(`Release ${next} not found in this project.`);
      }
      this.assertOpen(to, "attach to");
    }

    return next;
  }

  protected assertOpen(release: Release, verb: string): void {
    if (release.releasedAt) {
      throw new BadRequestError(
        `Cannot ${verb} ${release.tag ?? `release ${formatReference("release", release.number)}`}: it has been published. Reopen it first.`,
      );
    }
  }
}
