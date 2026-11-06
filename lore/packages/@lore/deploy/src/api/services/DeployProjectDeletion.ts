import { ProjectDeletionService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { stackEnvironments } from "../entities/stackEnvironments.ts";
import { stacks } from "../entities/stacks.ts";

/**
 * Deploy's step of a project deletion (#Q3169, found by the walk of epic
 * E116): the project lets go of every estate it held.
 *
 * A project delete from the owner is a SOFT delete, so no foreign key
 * cascades: before this step its copies, stacks and loans kept pointing at
 * their estates, and `EstateService.assertUnreferenced` refused to delete an
 * estate whose only user was a project already gone, with no command left
 * that could repoint it. A deleted project deploys nothing, so its rows
 * forget the estate (`estateId` null, as the database's own `set null`
 * would) and its loans go. Nothing on a machine is touched.
 */
export class DeployProjectDeletion {
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly instances = $repository(appInstances);
  protected readonly stacks = $repository(stacks);
  protected readonly stackEnvironments = $repository(stackEnvironments);
  protected readonly loans = $repository(estateProjects);

  constructor() {
    this.deletion.registerStep({
      order: 20,
      before: true,
      run: async (projectId) => {
        await this.release(projectId);
      },
    });
  }

  async release(projectId: number): Promise<void> {
    await this.instances.updateMany(
      { projectId: { eq: projectId }, estateId: { isNotNull: true } },
      { estateId: null },
    );
    const owned = await this.stacks.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    if (owned.length > 0) {
      await this.stackEnvironments.updateMany(
        {
          stackId: { inArray: owned.map((stack) => stack.id) },
          estateId: { isNotNull: true },
        },
        { estateId: null },
      );
      await this.stacks.updateMany(
        { projectId: { eq: projectId }, estateId: { isNotNull: true } },
        { estateId: null },
      );
    }
    await this.loans.deleteMany({ projectId: { eq: projectId } });
  }
}
