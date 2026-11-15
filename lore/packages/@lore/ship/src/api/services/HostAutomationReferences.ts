import { AutomationReferences } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { hosts } from "../entities/hosts.ts";

/**
 * Hosts own their automation references (#Q3627): the `host` picker of a
 * `host.*` trigger and its same-project check, against the home project.
 */
export class HostAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly hosts = $repository(hosts);
  constructor() {
    this.references.registerOptions("host", {
      permission: "host:read",
      read: async ({ projectId, offset, limit, search, ids }) => {
        const rows = await this.hosts.findMany({
          where: {
            projectId,
            ...(ids ? { id: { inArray: ids } } : {}),
            ...(search ? { slug: { contains: search } } : {}),
          },
          columns: ["id", "slug"],
          orderBy: [
            { column: "slug", direction: "asc" },
            { column: "id", direction: "asc" },
          ],
          offset,
          limit: limit + 1,
        });
        return {
          items: rows
            .slice(0, limit)
            .map((row) => ({ value: row.id, label: row.slug })),
          hasMore: rows.length > limit,
        };
      },
    });
    this.references.register("host", async (projectId, value) =>
      typeof value === "string" &&
      (
        await this.hosts.findMany({
          where: { id: value, projectId },
          columns: ["id"],
          limit: 1,
        })
      ).length
        ? undefined
        : "Host does not exist in this project",
    );
  }
}
