import { AlephaError } from "alepha";

import type { CapabilityKey } from "../../../api/schemas/capabilityKeySchema.ts";

/**
 * What stops a project from being deleted, or from losing a capability, said
 * BEFORE the click (#Q3281): each module registers a hook naming what its
 * server guard would refuse on (Deploy: the hosts the project is the home
 * of). The danger zone and the capability switch read every line and hold
 * the act back while one is present. The server guard stays the authority.
 *
 * Frozen at first read, like `AccountDeletionRegistry`, because the lines
 * are hooks and a hook list must not change between renders.
 */
export class ProjectBlockerRegistry {
  protected readonly entries: ProjectBlocker[] = [];
  protected frozen = false;

  public register(blocker: ProjectBlocker): void {
    if (this.frozen) {
      throw new AlephaError(
        `Project blocker '${blocker.key}' registered after the blockers were first read`,
      );
    }
    this.entries.push(blocker);
    this.entries.sort((a, b) => a.order - b.order);
  }

  public blockers(): readonly ProjectBlocker[] {
    this.frozen = true;
    return this.entries;
  }
}

/**
 * The act a blocker may stand in the way of: deleting the project, or
 * turning one of its capabilities off.
 */
export type ProjectBlockedAct = "delete" | { capabilityOff: CapabilityKey };

export interface ProjectBlocker {
  key: string;
  order: number;
  /**
   * A HOOK: the sentence naming what blocks `act` on this project, or
   * `undefined` while loading, on a failure, or when nothing does.
   */
  useLine: (projectId: number, act: ProjectBlockedAct) => string | undefined;
}
