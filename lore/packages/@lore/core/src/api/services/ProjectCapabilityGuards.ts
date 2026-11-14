import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";

/**
 * Refusals to turn a capability off, registered by the module that needs one
 * (#Q3280): Deploy refuses Apps off in a project that is the home of an
 * host, which could otherwise be managed through no page.
 *
 * Core cannot import a feature module, so `ProjectCapabilityController`
 * reads this registry before it deletes a capability row, and the feature
 * registers here. A guard throws to refuse.
 */
export class ProjectCapabilityGuards {
  protected readonly guards: ProjectCapabilityGuard[] = [];

  public register(guard: ProjectCapabilityGuard): void {
    this.guards.push(guard);
  }

  /**
   * Run the guards on `key`, before the capability is turned off.
   */
  public async assertCanTurnOff(
    projectId: number,
    key: CapabilityKey,
  ): Promise<void> {
    for (const guard of this.guards) {
      if (guard.key === key) {
        await guard.check(projectId);
      }
    }
  }
}

/**
 * One module's refusal to let a capability be turned off.
 */
export interface ProjectCapabilityGuard {
  key: CapabilityKey;
  /**
   * Names the guard in a log, `deploy`.
   */
  name: string;
  check: (projectId: number) => Promise<void>;
}
