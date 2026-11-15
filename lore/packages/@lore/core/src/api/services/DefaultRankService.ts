import { $inject, Alepha } from "alepha";
import {
  organizationMembers,
  RankService,
  type RankWriter,
} from "alepha/api/organizations";
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
    writer: RankWriter,
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
   * The writer a sweep acts as: the privileged identity, which the rank
   * service's subset rules let through (`ownership: false`). Not the owner's
   * row, which 47 production projects lacked when #Q3736 was written: a sweep
   * as the owner skipped every one of them.
   */
  public static readonly SYSTEM_WRITER = {
    id: "system",
    ownership: false,
  } as const;

  /**
   * Hard reset of a project's ranks to the four built-ins (#Q3736), in a
   * context of its own like {@link backfill}.
   *
   * - `admin` and `viewer` are rewritten to the presets; a name already
   *   stored is kept, since a rank is a thing people rename.
   * - Every other rank is deleted. Its holders move to `admin` when its name
   *   reads as an administrator (hand-made "Admin" ranks predate the
   *   built-in), and to the default `member` otherwise.
   *
   * Answers what it changed. Logged and skipped, never thrown, so one project
   * cannot stop the sweep.
   */
  public async reset(projectId: number): Promise<RankReset> {
    const result: RankReset = { projectId, rewritten: [], removed: [] };
    try {
      await this.alepha.context.run(async () => {
        const organizationId = await this.security.organizationIdOf(projectId);
        const enabled = Object.keys(
          await this.security.capabilitiesOf(projectId),
        ) as Parameters<ProjectRankPresets["presetsFor"]>[0];
        const held = await this.ranks.ranksOf(organizationId);
        const builtins = this.ranks.builtinKeys();

        for (const preset of this.presets.presetsFor(enabled)) {
          const existing = held.find((rank) => rank.key === preset.key);
          await this.ranks.save(
            organizationId,
            {
              key: preset.key,
              name: existing?.name ?? (await this.presets.nameFor(preset)),
              permissions: preset.permissions,
            },
            DefaultRankService.SYSTEM_WRITER as never,
          );
          result.rewritten.push(preset.key);
        }

        for (const rank of held) {
          if (builtins.has(rank.key)) continue;
          const target = DefaultRankService.ADMIN_NAMES.includes(
            rank.name.trim().toLowerCase(),
          )
            ? "admin"
            : null;
          await this.members.updateMany(
            {
              organizationId: { eq: organizationId },
              rank: { eq: rank.key },
            },
            { rank: target },
          );
          await this.ranks.delete(
            organizationId,
            rank.key,
            DefaultRankService.SYSTEM_WRITER as never,
          );
          result.removed.push(rank.key);
        }
      });
    } catch (error) {
      this.log.warn("ranks were not reset for this project", {
        projectId,
        error,
      });
    }
    return result;
  }

  /**
   * Names a hand-made rank carried when it meant what the built-in Admin is
   * now, compared trimmed and lowercased.
   */
  public static readonly ADMIN_NAMES = [
    "admin",
    "admins",
    "administrator",
    "administrators",
    "administrateur",
    "administrateurs",
  ];

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
      // As the privileged writer, not the owner's row: a project without one
      // was skipped forever (#Q3736).
      return await this.alepha.context.run(() =>
        this.seed(projectId, DefaultRankService.SYSTEM_WRITER),
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

// ---------------------------------------------------------------------------------------------------------------------

export interface RankReset {
  projectId: number;
  /**
   * The built-in keys rewritten to their preset.
   */
  rewritten: string[];
  /**
   * The keys of the custom ranks deleted.
   */
  removed: string[];
}
