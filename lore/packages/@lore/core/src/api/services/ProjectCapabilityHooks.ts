import { $logger } from "alepha/logger";

import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";

/**
 * What a module does when one of its capabilities is turned on (#E161):
 * Chat creates its `general` room.
 *
 * The mirror of {@link ProjectCapabilityGuards}, for the other direction,
 * and for the same reason: core cannot import a feature module, so the two
 * places a capability row is created, `createProject` (the wizard) and
 * `setCapability` (Settings), run this registry, and the feature registers
 * here.
 *
 * It runs when the row is CREATED, never when an existing row's options are
 * saved, so a hook runs once per time the capability goes from off to on.
 * Turning a capability off and on again runs it again: a hook is written to
 * be idempotent.
 *
 * Best effort, like the default ranks a new project is seeded with: a hook
 * that fails is logged, and the capability stays on. A switch refused over a
 * side effect would leave the owner with no way to turn the capability on.
 */
export class ProjectCapabilityHooks {
  protected readonly log = $logger();
  protected readonly hooks: ProjectCapabilityHook[] = [];

  public register(hook: ProjectCapabilityHook): void {
    this.hooks.push(hook);
  }

  /**
   * Run the hooks of `key`, after its row was created.
   */
  public async enabled(
    projectId: number,
    key: CapabilityKey,
    userId?: string,
  ): Promise<void> {
    for (const hook of this.hooks) {
      if (hook.key !== key) {
        continue;
      }
      try {
        await hook.enabled({ projectId, userId });
      } catch (error) {
        this.log.warn("A capability hook failed; the capability stays on", {
          hook: hook.name,
          key,
          projectId,
          error,
        });
      }
    }
  }
}

/**
 * One module's reaction to a capability being turned on.
 */
export interface ProjectCapabilityHook {
  key: CapabilityKey;
  /**
   * Names the hook in a log, `chat.general`.
   */
  name: string;
  /**
   * `userId` is who turned it on: the project's creator in the wizard, the
   * member who flipped the switch in Settings.
   */
  enabled: (event: { projectId: number; userId?: string }) => Promise<void>;
}
