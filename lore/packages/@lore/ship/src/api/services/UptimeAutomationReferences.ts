import { AutomationReferences } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { monitors } from "../entities/monitors.ts";

/**
 * Uptime owns its automation references (#Q3610): the `monitor` picker of a
 * `monitor.*` trigger and its same-project check. Every lookup includes the
 * project.
 */
export class UptimeAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly monitors = $repository(monitors);
  constructor() {
    this.references.registerOptions("monitor", {
      permission: "app:read",
      read: async ({ projectId, offset, limit, search, ids }) => {
        const rows = await this.monitors.findMany({
          where: {
            projectId,
            ...(ids ? { id: { inArray: ids } } : {}),
            ...(search ? { name: { contains: search } } : {}),
          },
          columns: ["id", "name"],
          orderBy: [
            { column: "name", direction: "asc" },
            { column: "id", direction: "asc" },
          ],
          offset,
          limit: limit + 1,
        });
        return {
          items: rows
            .slice(0, limit)
            .map((row) => ({ value: row.id, label: row.name.slice(0, 255) })),
          hasMore: rows.length > limit,
        };
      },
    });
    this.references.register("monitor", async (projectId, value) =>
      typeof value === "string" &&
      (
        await this.monitors.findMany({
          where: { id: value, projectId },
          columns: ["id"],
          limit: 1,
        })
      ).length
        ? undefined
        : "Monitor does not exist in this project",
    );
  }
}
