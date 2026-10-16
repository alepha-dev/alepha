import { $hook, AlephaError } from "alepha";
import { $repository } from "alepha/orm";

import { automationAdoptions } from "../entities/automationAdoptions.ts";
import { automationEvents } from "../entities/automationEvents.ts";
import { automationReceipts } from "../entities/automationReceipts.ts";
import { automationRuns } from "../entities/automationRuns.ts";
import { automations } from "../entities/automations.ts";
import { automationVariables } from "../entities/automationVariables.ts";

/**
 * Registers the model before database boot and guards its immutable provenance.
 * Domain adapters and the execution service use these same repositories.
 */
export class AutomationPersistence {
  public readonly adoptions = $repository(automationAdoptions);
  public readonly events = $repository(automationEvents);
  public readonly receipts = $repository(automationReceipts);
  public readonly rules = $repository(automations);
  public readonly variables = $repository(automationVariables);
  public readonly runs = $repository(automationRuns);

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
}
