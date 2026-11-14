import { ProjectDeletionService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { hostProjects } from "../entities/hostProjects.ts";
import { stackEnvironments } from "../entities/stackEnvironments.ts";
import { stacks } from "../entities/stacks.ts";

/**
 * Deploy's step of a project deletion (#Q3169, found by the walk of epic
 * E116): the project lets go of every host it held.
 *
 * A project delete from the owner is a SOFT delete, so no foreign key
 * cascades: before this step its copies, stacks and loans kept pointing at
 * their hosts, and `HostService.assertUnreferenced` refused to delete an
 * host whose only user was a project already gone, with no command left
 * that could repoint it. A deleted project deploys nothing, so its rows
 * forget the host (`hostId` null, as the database's own `set null`
 * would) and its loans go. Nothing on a machine is touched.
 */
export class DeployProjectDeletion {
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly instances = $repository(appInstances);
  protected readonly stacks = $repository(stacks);
  protected readonly stackEnvironments = $repository(stackEnvironments);
  protected readonly loans = $repository(hostProjects);

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
      { projectId: { eq: projectId }, hostId: { isNotNull: true } },
      { hostId: null },
    );
    const owned = await this.stacks.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    if (owned.length > 0) {
      await this.stackEnvironments.updateMany(
        {
          stackId: { inArray: owned.map((stack) => stack.id) },
          hostId: { isNotNull: true },
        },
        { hostId: null },
      );
      await this.stacks.updateMany(
        { projectId: { eq: projectId }, hostId: { isNotNull: true } },
        { hostId: null },
      );
    }
    await this.loans.deleteMany({ projectId: { eq: projectId } });
  }
}
