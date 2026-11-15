import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { organizationRanks } from "alepha/api/organizations";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";
import { DefaultRankService } from "../services/DefaultRankService.ts";

/**
 * Backfills the default ranks, `admin` and `viewer`, into projects created
 * before every project started with them (#Q3661).
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

  public readonly seedDefaultRanks = $job({
    name: "ranks.seed-defaults",
    description:
      "Adds the Admin and Viewer ranks to projects that lack them; an existing rank is never changed.",
    cron: "0 3 * * *",
    timeout: [2, "minutes"],
    // A failed daily tick has otherwise lost a day: `retry` puts it on the
    // outbox, which the sweep picks up within `sweepCron`.
    retry: { retries: 2 },
    handler: async () => {
      const held = await this.definitions.findMany({
        where: {
          key: { inArray: [...DefaultRankService.DEFAULT_KEYS] },
        },
        columns: ["organizationId", "key"],
      });
      const complete = new Set<string>();
      const seen = new Map<string, Set<string>>();
      for (const row of held) {
        const keys = seen.get(row.organizationId) ?? new Set<string>();
        keys.add(row.key);
        seen.set(row.organizationId, keys);
        if (keys.size === DefaultRankService.DEFAULT_KEYS.length) {
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
