import { AutomationReferences } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { deployments } from "../entities/deployments.ts";

/**
 * This module owns its automation reference checks; every lookup includes projectId.
 */
export class DeployAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly deployments = $repository(deployments);
  protected readonly instances = $repository(appInstances);
  constructor() {
    this.references.registerOptions("deployment", {
      permission: "app:read",
      read: async ({ projectId, offset, limit, search, ids }) => {
        const rows = await this.deployments.findMany({
          where: {
            projectId,
            ...(ids ? { id: { inArray: ids } } : {}),
            ...(search
              ? {
                  or: [
                    { app: { contains: search } },
                    { tag: { contains: search } },
                  ],
                }
              : {}),
          },
          columns: ["id", "app", "tag", "status"],
          orderBy: [
            { column: "createdAt", direction: "desc" },
            { column: "id", direction: "desc" },
          ],
          offset,
          limit: limit + 1,
        });
        return {
          items: rows.slice(0, limit).map((row) => ({
            value: row.id,
            label: `${row.app}: ${row.tag} (${row.status})`.slice(0, 255),
          })),
          hasMore: rows.length > limit,
        };
      },
    });
    this.references.registerOptions("app", {
      permission: "app:read",
      read: async ({ projectId, offset, limit, search, ids }) => {
        const rows = await this.instances.findMany({
          where: {
            projectId,
            ...(ids ? { app: { inArray: ids } } : {}),
            ...(search ? { app: { contains: search } } : {}),
          },
          columns: ["app"],
          distinct: ["app"],
          orderBy: "app",
          offset,
          limit: limit + 1,
        });
        return {
          items: rows
            .slice(0, limit)
            .map((row) => ({ value: row.app, label: row.app })),
          hasMore: rows.length > limit,
        };
      },
    });
    this.references.register("app", async (projectId, value) =>
      typeof value === "string" &&
      (
        await this.instances.findMany({
          where: { app: value, projectId },
          columns: ["id"],
          limit: 1,
        })
      ).length
        ? undefined
        : "App does not exist in this project",
    );
  }
}
