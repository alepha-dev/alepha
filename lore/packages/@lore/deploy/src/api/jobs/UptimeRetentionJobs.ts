import { z } from "alepha";
import { $job } from "alepha/api/jobs";
import { $repository, sql } from "alepha/orm";

import { monitorHeartbeats } from "../entities/monitorHeartbeats.ts";
import { monitorIncidents } from "../entities/monitorIncidents.ts";
import { monitors } from "../entities/monitors.ts";

/**
 * Keeps the last 100 beats for each monitor, including paused monitors.
 */
export class UptimeRetentionJobs {
  protected readonly monitors = $repository(monitors);
  protected readonly incidents = $repository(monitorIncidents);
  protected readonly beats = $repository(monitorHeartbeats);

  public readonly pruneHeartbeats = $job({
    name: "uptime.prune-heartbeats",
    description: "Keeps the newest 100 individual checks per uptime monitor.",
    cron: "0 3 * * *",
    lock: true,
    timeout: [2, "minutes"],
    handler: async () => {
      // One statement avoids a read/delete race and an unbounded IN list.
      const beats = this.beats.table;
      await this.beats.query(
        sql`
          DELETE FROM ${beats} WHERE ${beats.id} IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (
                PARTITION BY monitor_id ORDER BY at DESC, id DESC
              ) AS position FROM ${beats}
            ) ranked WHERE position > 100
          ) RETURNING id
        `,
        z.object({ id: z.uuid() }),
      );
    },
  });
}
