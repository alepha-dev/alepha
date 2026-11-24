import { $inject, Alepha } from "alepha";
import {
  organizationMembers,
  organizationRanks,
  RankService,
  type RankWriter,
} from "alepha/api/organizations";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { SecurityProvider } from "alepha/security";

import { ProjectRankPresets } from "../security/ProjectRankPresets.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * Gives a project the default ranks it lacks: `viewer`, beside the `owner`
 * and `member` built-ins (#Q3661, epic #E151). `admin` is no longer seeded
 * (#Q3920): the framework reads it from `organizationConfigAtom.defaultRanks`
 * until somebody edits it, so it is always held, and a permission declared
 * later reaches it.
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
  protected readonly definitions = $repository(organizationRanks);
  protected readonly securityProvider = $inject(SecurityProvider);

  /**
   * The rank keys stored as rows, which the nightly sweep looks for.
   */
  public static readonly SEEDED_KEYS = ["viewer"] as const;

  /**
   * The permissions declared after #Q3736 seeded every Admin as a stored
   * snapshot (2026-11-15), which no such snapshot could hold: personas, use
   * cases and requirements (#E153), subscriptions (#Q3890).
   */
  public static readonly ADMIN_LATE_PERMISSIONS = [
    "persona:read",
    "persona:write",
    "usecase:read",
    "usecase:write",
    "usecase:validate",
    "requirement:read",
    "requirement:write",
    "subscription:read",
    "subscription:manage",
    // Agent automations (#Q4226): a snapshot written before them lacks it.
    "automation:manage",
  ];

  /**
   * Admin rows written before this instant may be snapshots; any later write
   * is somebody's edit, kept whatever it holds.
   */
  public static readonly ADMIN_SNAPSHOT_CUTOFF = "2026-11-20T00:00:00.000Z";

  /**
   * Add the default ranks this project lacks, written as `writer`. Answers
   * the keys it added. Named in English (#Q3744).
   */
  public async seed(projectId: number, writer: RankWriter): Promise<string[]> {
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
          name: this.presets.nameFor(preset),
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
          if (this.ranks.defaultPermissionsOf(preset.key)) {
            // A default rank: its row goes, so it follows the code (#Q3920).
            await this.ranks.reset(
              organizationId,
              preset.key,
              DefaultRankService.SYSTEM_WRITER as never,
            );
            result.rewritten.push(preset.key);
            continue;
          }
          await this.ranks.save(
            organizationId,
            {
              key: preset.key,
              name: existing?.name ?? this.presets.nameFor(preset),
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
   * Delete the stored Admin rows that are only stale snapshots, so they read
   * the default again (#Q3920). Answers how many went.
   *
   * A snapshot was written before {@link ADMIN_SNAPSHOT_CUTOFF}, lacks
   * nothing of the Admin default but {@link ADMIN_LATE_PERMISSIONS}, and
   * holds nothing beyond it but permissions the application no longer
   * declares (the automations' of #Q3896). A row somebody narrowed on
   * purpose fails the second test and is kept, as is anything written since.
   */
  public async dropStaleAdmins(): Promise<number> {
    const declared = new Set(
      this.securityProvider
        .getPermissions()
        .map((permission) =>
          permission.group
            ? `${permission.group}:${permission.name}`
            : permission.name,
        ),
    );
    const preset = new Set(ProjectRankPresets.ADMIN);
    const late = new Set(DefaultRankService.ADMIN_LATE_PERMISSIONS);
    const cutoff = new Date(DefaultRankService.ADMIN_SNAPSHOT_CUTOFF).getTime();
    const rows = await this.definitions.findMany({
      where: { key: { eq: "admin" } },
    });
    let dropped = 0;
    for (const row of rows) {
      if (new Date(row.updatedAt).getTime() >= cutoff) continue;
      const held = new Set(row.permissions);
      const lacks = [...preset].filter((it) => !held.has(it));
      const beyond = row.permissions.filter(
        (it) => !preset.has(it) && declared.has(it),
      );
      if (beyond.length || lacks.some((it) => !late.has(it))) continue;
      await this.definitions.deleteById(row.id);
      dropped += 1;
    }
    return dropped;
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
