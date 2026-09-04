import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { type Release, releases } from "../entities/releases.ts";

/**
 * The single answer to "may this thing be put in, or taken out of, that
 * release".
 *
 * **A service rather than a line in a handler, on purpose.** The write paths
 * that attach something to a release live in four files across three modules:
 * `EpicController.updateEpic`, `QuestController.updateQuestById`,
 * `ProjectQuestPortabilityController`'s CSV import, and
 * `src/mcp/tools/QuestTools.ts`. A refusal copied into each of them is the
 * shape of the 13-endpoint precondition bug `EpicVisibilityService` exists to
 * prevent: the copies drift, and the one that was forgotten is the one nobody
 * looks at.
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
