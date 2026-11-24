import { AlephaError } from "alepha";

import type { ProjectEvent } from "../entities/projectEvents.ts";

/**
 * What else hears a project event besides its subscribers (#Q4227): an
 * agent automation listening to it. Subscriptions stay "who is told"; a
 * listener is code a module registers, asked by the delivery job after the
 * subscriptions.
 *
 * - `listens` decides whether an event's delivery job is written at all,
 *   so an event nobody follows and nobody listens to still costs one insert;
 * - `receive` is called once per event, as one memoised step of its
 *   delivery job.
 */
export class ProjectEventListeners {
  protected readonly listeners = new Map<string, ProjectEventListener>();

  public register(listener: ProjectEventListener): void {
    if (this.listeners.has(listener.name)) {
      throw new AlephaError(
        `Project event listener '${listener.name}' is registered twice`,
      );
    }
    this.listeners.set(listener.name, listener);
  }

  public all(): ProjectEventListener[] {
    return [...this.listeners.values()];
  }

  /**
   * Whether any listener hears this event in this project.
   */
  public async listening(projectId: number, name: string): Promise<boolean> {
    for (const listener of this.listeners.values()) {
      if (await listener.listens(projectId, name)) return true;
    }
    return false;
  }
}

export interface ProjectEventListener {
  /** `automations`: the step's name in the delivery job. */
  name: string;
  listens(projectId: number, event: string): Promise<boolean>;
  receive(event: ProjectEvent): Promise<void>;
}
