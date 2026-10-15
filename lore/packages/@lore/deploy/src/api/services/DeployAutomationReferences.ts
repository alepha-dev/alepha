import { AutomationReferences } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";

/**
 * This module owns its automation reference checks; every lookup includes projectId.
 */
export class DeployAutomationReferences {
  protected readonly references = $inject(AutomationReferences);
  protected readonly instances = $repository(appInstances);
  constructor() {
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
