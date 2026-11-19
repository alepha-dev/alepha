import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { organizationRanks } from "alepha/api/organizations";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";
import { DefaultRankService } from "../services/DefaultRankService.ts";

/**
 * Backfills the seeded rank, `viewer`, into projects created before every
 * project started with it (#Q3661), and drops the stale Admin snapshots so
 * they follow the default (#Q3920).
 *
 * A nightly sweep rather than a migration: a rank is written through
 * `RankService.save`, which a SQL migration cannot call, and the sweep also
 * heals a project whose seeding failed at creation.
 */
export class DefaultRankJobs {
  protected readonly log = $logger();
  protected readonly projects = $repository(projects);
  protected readonly definitions = $repository(organizationRanks);
  protected readonly defaults = $inject(DefaultRankService);

  /**
   * The one-time hard reset of #Q3736: every project down to the four
   * built-in ranks, Admin and Viewer rewritten to their presets. Queue-only,
   * so it runs when somebody triggers it from Admin > Jobs and never on its
   * own: a second run is harmless (it finds nothing to remove), but it would
   * overwrite whatever owners changed in Admin and Viewer since.
   */
  public readonly resetRanks = $job({
    name: "ranks.reset-builtins",
    description:
      "Resets every project to the owner, admin, member and viewer ranks: Admin and Viewer back to their presets, every custom rank deleted (its holders move to Admin or Member).",
    // An empty payload: queue-only, so it has to name one.
    schema: z.object({}),
    timeout: [10, "minutes"],
    handler: async () => {
      const all = await this.projects.findMany({
        columns: ["id", "organizationId"],
      });
      let removed = 0;
      for (const project of all) {
        if (!project.organizationId) continue;
        removed += (await this.defaults.reset(project.id)).removed.length;
      }
      this.log.info("ranks reset to the built-ins", {
        projects: all.length,
        removed,
      });
    },
  });

  public readonly seedDefaultRanks = $job({
    name: "ranks.seed-defaults",
    description:
      "Adds the Viewer rank to projects that lack it, and lets the Admin snapshots stored before 2026-11-20 follow the default again; an edited rank is never changed.",
    cron: "0 3 * * *",
    timeout: [2, "minutes"],
    // A failed daily tick has otherwise lost a day: `retry` puts it on the
    // outbox, which the sweep picks up within `sweepCron`.
    retry: { retries: 2 },
    handler: async () => {
      const dropped = await this.defaults.dropStaleAdmins();
      if (dropped) {
        this.log.info("admin snapshots now follow the default", { dropped });
      }
      const held = await this.definitions.findMany({
        where: {
          key: { inArray: [...DefaultRankService.SEEDED_KEYS] },
        },
        columns: ["organizationId", "key"],
      });
      const complete = new Set<string>();
      const seen = new Map<string, Set<string>>();
      for (const row of held) {
        const keys = seen.get(row.organizationId) ?? new Set<string>();
        keys.add(row.key);
        seen.set(row.organizationId, keys);
        if (keys.size === DefaultRankService.SEEDED_KEYS.length) {
          complete.add(row.organizationId);
        }
      }

      const pending = (
        await this.projects.findMany({ columns: ["id", "organizationId"] })
      ).filter(
        (row) => row.organizationId && !complete.has(row.organizationId),
      );
      if (!pending.length) return;

      this.log.info("seeding default ranks into projects that lack them", {
        projects: pending.length,
      });
      for (const project of pending) {
        await this.defaults.backfill(project.id);
      }
    },
  });
}
