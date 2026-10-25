import { AlephaError } from "alepha";

import type { AssignedWorkItem } from "../schemas/assignedWorkItemSchema.ts";

/**
 * The viewer's open work in a project, which core shows and Work owns (#E75,
 * #Q2623): the project responses' `quests`, the orientation tools'
 * `activeQuests`.
 *
 * One provider, registered by the module that owns work items. Without it a
 * viewer has no open work, which is the honest answer of a project with no
 * Work module.
 */
export class AssignedWorkRegistry {
  protected provider?: AssignedWorkProvider;

  public register(provider: AssignedWorkProvider): void {
    if (this.provider) {
      throw new AlephaError(
        "Assigned work is registered twice: one module owns work items",
      );
    }
    this.provider = provider;
  }

  /**
   * The open items `userId` accepted in the project, or none.
   */
  public async of(
    projectId: number,
    userId: string,
  ): Promise<AssignedWorkItem[]> {
    return this.provider ? this.provider(projectId, userId) : [];
  }
}

export type AssignedWorkProvider = (
  projectId: number,
  userId: string,
) => Promise<AssignedWorkItem[]>;
