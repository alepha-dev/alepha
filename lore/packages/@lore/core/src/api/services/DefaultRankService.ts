import { $inject, Alepha } from "alepha";
import { organizationMembers, RankService } from "alepha/api/organizations";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { ProjectRankPresets } from "../security/ProjectRankPresets.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * Gives a project the default ranks it lacks: `admin` and `viewer`, beside
 * the `owner` and `member` built-ins (#Q3661, epic #E151).
 *
 * Called by `createProject` and by the nightly backfill in
 * `DefaultRankJobs`. A rank is added only when no rank holds its KEY, so
 * whatever an owner did to an existing `admin` or `viewer` stands.
 *
 * ⚠️ An existing `viewer` wider than the allowlist is NOT narrowed here: the
 * people it was given to would silently lose reads. The ranks page flags it,
 * and opening the project is refused until it fits.
 *
 * Goes through {@link RankService.save}, the write path with the invariants
 * on it, so a preset that ever grew an owner-only permission or lost the
 * floor is refused rather than stored.
 */
export class DefaultRankService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly ranks = $inject(RankService);
  protected readonly presets = $inject(ProjectRankPresets);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly members = $repository(organizationMembers);

  /**
   * The rank keys every project holds once seeded.
   */
  public static readonly DEFAULT_KEYS = ["admin", "viewer"] as const;

  /**
   * Add the default ranks this project lacks, written as `writer`. Answers
   * the keys it added.
   *
   * `language` names them in the creator's language; the backfill passes
   * none and gets English, as the old sweep did.
   */
  public async seed(
    projectId: number,
    writer: { id: string },
    language?: string,
  ): Promise<string[]> {
    const organizationId = await this.security.organizationIdOf(projectId);
    const held = new Set(
      (await this.ranks.ranksOf(organizationId)).map((rank) => rank.key),
    );
    const enabled = Object.keys(
      await this.security.capabilitiesOf(projectId),
    ) as Parameters<ProjectRankPresets["presetsFor"]>[0];

    const added: string[] = [];
    for (const preset of this.presets.presetsFor(enabled)) {
      if (held.has(preset.key)) continue;
      await this.ranks.save(
        organizationId,
        {
          key: preset.key,
          name: await this.presets.nameFor(preset, language),
          permissions: preset.permissions,
        },
        writer as never,
      );
      added.push(preset.key);
    }
    return added;
  }

  /**
   * {@link seed} for a project outside any request, as its owner, in a
   * context of its own: `RankService` memoizes the writer's membership on the
   * store, and one project's memo must not answer for the next.
   *
   * Logged and skipped, never thrown: one project that cannot be seeded must
   * not stop the ones after it, and the next sweep retries it.
   */
  public async backfill(projectId: number): Promise<string[]> {
    try {
      const organizationId = await this.security.organizationIdOf(projectId);
      const owner = await this.members.findOne({
        where: {
          organizationId: { eq: organizationId },
          rank: { eq: "owner" },
        },
      });
      if (!owner) {
        this.log.warn("skipping default ranks: the project has no owner row", {
          projectId,
        });
        return [];
      }
      return await this.alepha.context.run(() =>
        this.seed(projectId, { id: owner.userId }),
      );
    } catch (error) {
      this.log.warn("default ranks were not seeded for this project", {
        projectId,
        error,
      });
      return [];
    }
  }
}
