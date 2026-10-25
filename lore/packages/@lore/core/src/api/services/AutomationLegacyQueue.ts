import { $inject, Alepha, AlephaError } from "alepha";
import { JobProvider } from "alepha/api/jobs";
import type { SQLLike } from "alepha/orm";

import type { AutomationAdoptionPolicy } from "../schemas/automationAdoptionPolicySchema.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationLegacyJobProvider } from "./AutomationLegacyJobProvider.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * Only server code supplies a legacy enqueue fence. An adopted choice never falls back.
 */
export class AutomationLegacyQueue {
  protected readonly alepha = $inject(Alepha);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly persistence = $inject(AutomationPersistence);
  public available(): boolean {
    return (
      this.alepha.inject(JobProvider) instanceof AutomationLegacyJobProvider
    );
  }
  public async adopted(
    projectId: number,
    policy: AutomationAdoptionPolicy,
  ): Promise<boolean> {
    return this.database.primary(
      async () =>
        !!(await this.persistence.adoptions.findOne({
          where: { projectId, policy, state: "adopted" },
        })),
    );
  }
  public async run<T>(
    input: AutomationLegacyFence,
    task: () => Promise<T>,
  ): Promise<T | undefined> {
    return this.database.primary(async () => {
      if (await this.adopted(input.projectId, input.policy)) return;
      try {
        if (!this.available()) return await task();
        return await this.alepha.context.nest(() => {
          this.alepha.context.set("lore.automations.legacy-enqueue", input);
          return task();
        });
      } catch (error) {
        if (error instanceof AutomationLegacyHandled) return;
        throw error;
      }
    });
  }
}
export interface AutomationLegacyFence {
  projectId: number;
  policy: AutomationAdoptionPolicy;
  identity: string;
  template: string;
  condition?: SQLLike;
  statements?: SQLLike[];
  changedTables?: string[];
}
export class AutomationLegacyHandled extends AlephaError {}
