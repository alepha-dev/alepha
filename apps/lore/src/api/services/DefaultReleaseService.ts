import { z } from "alepha";
import { $repository, sql } from "alepha/orm";

import { type Release, releases } from "../entities/releases.ts";
import { compareReleaseTags, parseReleaseTag } from "../releaseOrder.ts";

/**
 * The project's DEFAULT release: where a completed quest that names no
 * release, and inherits none from its epic, lands.
 *
 * ## What it is, and what it is not
 *
 * A quality-of-life fallback, not a lifecycle stage. N releases stay open, a
 * hotfix is still a release created beside the one it patches, and
 * `ReleaseController`'s deliberate absence of a one-open-at-a-time guard is
 * untouched. A default release is still `open`, which is why `ReleaseState`
 * keeps exactly two values.
 *
 * Zero defaults is a normal, supported state. Creating the first release of a
 * project does NOT make it the default: pointing intake somewhere is an
 * explicit act, and nothing ever picks a default for a project that has none.
 *
 * ## Publishing hands it on
 *
 * The one move nobody asks for is {@link DefaultReleaseService.successor}:
 * when the default ships, intake moves to the release next in line. That is
 * not a guess on a project's behalf. It only carries on a choice the owner
 * already made, that this project has a default at all, and it follows a rule
 * a reader can check: the lowest open release above the one that shipped
 * whose patch is zero.
 *
 * ## Why the swap is one statement
 *
 * D1 has no transactions, so a clear-then-set pair can leave a project with
 * two defaults or with none. `ProjectController.transferOwnership` solved this
 * exact shape for the one-owner rule; {@link DefaultReleaseService.set} copies
 * it, and the write path being single is the invariant.
 *
 * ⚠️ **There is deliberately no partial unique index behind it.** A
 * `UNIQUE (projectId) WHERE default_since IS NOT NULL` looks like the obvious
 * belt and is a bug: SQLite checks uniqueness per row as the `UPDATE` walks
 * the table, so a statement that sets one row and clears another transiently
 * holds two and throws depending on row order, with no deferred constraint to
 * fall back on. The index on the entity is non-unique, for lookup only.
 *
 * ## Why the readers are separate from the writer
 *
 * {@link DefaultReleaseService.openDefault} is what `QuestController`'s
 * completion path and `EpicController`'s Begin edge ask, and it is **best
 * effort by construction**: it answers `undefined` for a project with no
 * default, for a default that has since been published, and for a read that
 * failed. A quest that will not close, or an epic that will not begin,
 * because of a planning convenience is a worse bug than a missed attachment,
 * which is why neither of those paths goes through
 * `ReleaseAttachmentService.resolve` - that method throws, by design.
 */
export class DefaultReleaseService {
  releases = $repository(releases);

  /**
   * The one column the two statements below return. A field rather than a
   * module-level const, because this repository forbids code outside classes.
   */
  protected readonly idOnly = z.object({ id: z.integer() });

  /**
   * The row that carries `defaultSince`, whatever state it is in.
   *
   * Used by the write path, which has to name the release intake was taken
   * away from, and by the audit row. Readers deciding where to put work want
   * {@link DefaultReleaseService.openDefault} instead.
   */
  async current(projectId: number): Promise<Release | undefined> {
    return await this.releases.findOne({
      where: {
        projectId: { eq: projectId },
        defaultSince: { isNotNull: true },
      },
    });
  }

  /**
   * The project's default release, only if it is still open.
   *
   * Never throws: every caller is on a path that must complete whether or not
   * a release is waiting for its output.
   *
   * ⚠️ The published check is re-read here rather than assumed. The window is
   * small and real: there is no transaction on D1, and a concurrent
   * `publishRelease` would otherwise leave the frozen counts disagreeing with
   * the contents by one.
   */
  async openDefault(projectId: number): Promise<Release | undefined> {
    const release = await this.current(projectId).catch(() => undefined);
    return release && !release.releasedAt ? release : undefined;
  }

  /**
   * The release intake moves to when `published`, the default, ships, or
   * `undefined` when nothing is next in line.
   *
   * Next in line is the LOWEST open release above `published` whose patch is
   * zero. "The next minor, else the next major" needs no second rule: every
   * minor of a major sorts below the next major, so `0.30.0` is picked over
   * `1.0.0` for free, and `1.0.0` only once no `0.x.0` is left above.
   *
   * What it never picks, each for a reason:
   *
   * - **A patch** (`0.29.1`). A hotfix is filed by hand, beside the release it
   *   patches, and intake catching loose work into it would put unrelated
   *   quests in a hotfix's changelog.
   * - **A prerelease** (`1.0.0-rc.1`), for the same reason as a patch: it is a
   *   side step on the way to its release, not the next line of work.
   * - **Anything at or below `published`.** An older release somebody left
   *   open is not "next", and moving intake backwards would be a surprise.
   * - **A tag that is not a version** (`demo-2`). It has no place in the
   *   sequence, and a named `published` (`demo-1`) has no "next" at all.
   *
   * Ordered by the parsed tag, never by `number`: a release's `number` is
   * creation order, and planning `1.0.0` before `0.30.0` is ordinary.
   */
  async successor(published: Release): Promise<Release | undefined> {
    if (!published.tag || !parseReleaseTag(published.tag)) return undefined;

    const open = await this.releases.findMany({
      where: {
        projectId: { eq: published.projectId },
        releasedAt: { isNull: true },
      },
    });

    return open
      .filter(
        (release) =>
          release.id !== published.id &&
          this.isMainLine(release.tag) &&
          compareReleaseTags(release.tag, published.tag) > 0,
      )
      .sort((a, b) => compareReleaseTags(a.tag, b.tag) || a.number - b.number)
      .at(0);
  }

  /**
   * Whether a tag names a release on the main line: a version whose patch,
   * and every segment after it, is zero, with no prerelease suffix. `0.30`
   * counts, and reads as `0.30.0` the way the Releases table sorts it.
   */
  protected isMainLine(tag: string | undefined): boolean {
    const parts = tag ? parseReleaseTag(tag) : undefined;
    if (!parts || parts.pre) return false;
    return parts.core.slice(2).every((segment) => segment === 0);
  }

  /**
   * Point the project's intake at one release, or at nothing.
   *
   * ⚠️ **One statement per direction, and that is the whole design.** See the
   * class doc: a clear-then-set pair has no transaction to make it atomic on
   * D1.
   *
   * ⚠️ `RETURNING` is not decoration. `Repository.query` throws `DbError` on a
   * result that is not an array of rows, which is what an `UPDATE` without it
   * answers. One column, with its own schema: `RETURNING *` decodes through
   * the entity schema and SQLite hands `createdAt` back as a number, so the
   * statement succeeds and the decode throws, which reads as a failed write
   * that already happened.
   *
   * ⚠️ `sql.identifier(t.defaultSince.name)` on the left of the `SET`, not
   * `${t.defaultSince}`. Interpolating the column object renders it qualified
   * (`"releases"."default_since"`), which SQLite rejects there. On the right
   * of `WHERE` the qualified form is what you want, and is what the precedent
   * does.
   *
   * @param releaseId the release to point at, or `null` to point at nothing
   */
  async set(
    projectId: number,
    releaseId: number | null,
    now: string,
  ): Promise<void> {
    if (releaseId == null) {
      await this.releases.query(
        (t) => sql`
          UPDATE ${t}
          SET ${sql.identifier(t.defaultSince.name)} = NULL
          WHERE ${t.projectId} = ${projectId}
            AND ${t.defaultSince} IS NOT NULL
          RETURNING ${t.id}
        `,
        this.idOnly,
      );
      return;
    }

    await this.releases.query(
      (t) => sql`
        UPDATE ${t}
        SET ${sql.identifier(t.defaultSince.name)} = CASE
          WHEN ${t.id} = ${releaseId} THEN ${now}
          ELSE NULL
        END
        WHERE ${t.projectId} = ${projectId}
          AND (${t.id} = ${releaseId} OR ${t.defaultSince} IS NOT NULL)
        RETURNING ${t.id}
      `,
      this.idOnly,
    );
  }
}
