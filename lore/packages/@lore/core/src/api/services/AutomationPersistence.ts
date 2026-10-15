import { $hook, $inject, AlephaError } from "alepha";
import { $repository } from "alepha/orm";

import { automationRuns } from "../entities/automationRuns.ts";
import { automations } from "../entities/automations.ts";
import { automationVariables } from "../entities/automationVariables.ts";
import { projects } from "../entities/projects.ts";
import { BestEffort } from "./BestEffort.ts";

/**
 * Registers the model before database boot and guards its immutable provenance.
 * Domain adapters and the execution service use these same repositories.
 */
export class AutomationPersistence {
  public readonly rules = $repository(automations);
  public readonly variables = $repository(automationVariables);
  public readonly runs = $repository(automationRuns);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly projects = $repository(projects);

  protected readonly immutableAuthor = $hook({
    on: "repository:update:before",
    handler: ({ tableName, data }) => {
      if (
        tableName === automations.name &&
        Object.hasOwn(data, "authorUserId")
      ) {
        throw new AlephaError("Automation authorship is immutable");
      }
    },
  });

  protected readonly disabledCreation = $hook({
    on: "repository:create:before",
    handler: ({ tableName, data }) => {
      if (
        tableName === automations.name &&
        (Array.isArray(data) ? data : [data]).some(
          (row) => row.enabled === true,
        )
      ) {
        throw new AlephaError(
          "Create an automation disabled, then explicitly enable it",
        );
      }
    },
  });

  protected readonly memberRemoved = $hook({
    on: "organization:member:removed",
    handler: async ({ organizationId, userId }) => {
      await this.bestEffort.run(
        "Pause automations after author removal",
        async () => {
          const project = await this.projects.findOne({
            where: { organizationId },
          });
          if (!project) return;
          await this.rules.updateMany(
            { projectId: project.id, authorUserId: userId },
            {
              health: "paused",
              reason: "Author is no longer a project member",
              requiresApproval: true,
            },
          );
        },
      );
    },
  });
}
