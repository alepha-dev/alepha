import { $repository } from "alepha/orm";

import { automationEvents } from "../entities/automationEvents.ts";
import { automationReceipts } from "../entities/automationReceipts.ts";
import { automationRuns } from "../entities/automationRuns.ts";
import { automations } from "../entities/automations.ts";
import { automationVariables } from "../entities/automationVariables.ts";

/**
 * The five tables the automation engine wrote (#Q3896), declared so they
 * stay in the schema until #Q3902 drops them in a deploy of its own:
 * dropping them here would fail the previous Worker's writes during the
 * migrate-then-deploy window. Nothing reads or writes them.
 */
export class RetiredTables {
  protected readonly rules = $repository(automations);
  protected readonly runs = $repository(automationRuns);
  protected readonly receipts = $repository(automationReceipts);
  protected readonly variables = $repository(automationVariables);
  protected readonly events = $repository(automationEvents);
}
