import { $inject, AlephaError } from "alepha";
import type { NotificationPayload } from "alepha/api/notifications";

import type { AutomationAdoptionPolicy } from "../schemas/automationAdoptionPolicySchema.ts";
import { AutomationLegacyQueue } from "./AutomationLegacyQueue.ts";

/**
 * Feature adapters identify old queued payloads without importing feature tables into core.
 */
export class AutomationLegacyDispatch {
  protected readonly legacy = $inject(AutomationLegacyQueue);
  protected readonly handlers = new Map<
    string,
    {
      policy: AutomationAdoptionPolicy;
      project: (payload: NotificationPayload) => Promise<number | undefined>;
    }
  >();
  public register(
    template: string,
    policy: AutomationAdoptionPolicy,
    project: (payload: NotificationPayload) => Promise<number | undefined>,
  ): void {
    if (this.handlers.has(template))
      throw new AlephaError(
        `Legacy dispatch '${template}' is already registered`,
      );
    this.handlers.set(template, { policy, project });
  }
  public async allowed(payload: NotificationPayload): Promise<boolean> {
    const handler = this.handlers.get(payload.template);
    if (!handler) return true;
    const projectId = await handler.project(payload);
    return (
      projectId !== undefined &&
      !(await this.legacy.adopted(projectId, handler.policy))
    );
  }
}
