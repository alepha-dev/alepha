import { $inject } from "alepha";
import { JobProvider } from "alepha/api/jobs";

import { AutomationLegacyJobRepository } from "./AutomationLegacyJobRepository.ts";
import { AutomationLegacyHandled } from "./AutomationLegacyQueue.ts";

/**
 * Normal job validation, retry policy and dispatch use the application's native enqueue seam.
 */
export class AutomationLegacyJobProvider extends JobProvider {
  protected override readonly executions = $inject(
    AutomationLegacyJobRepository,
  );
  public override async pushMany(...args: Parameters<JobProvider["pushMany"]>) {
    if (!this.alepha.context.get("lore.automations.legacy-enqueue"))
      return super.pushMany(...args);
    const ids: string[] = [];
    for (const item of args[1]) {
      try {
        ids.push(...(await super.pushMany(args[0], [item])));
      } catch (error) {
        if (!(error instanceof AutomationLegacyHandled)) throw error;
      }
    }
    return ids;
  }
}
