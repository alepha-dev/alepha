import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { hostProjects } from "../entities/hostProjects.ts";
import { HostJobService } from "./HostJobService.ts";
import { ProjectDeletionService } from "./ProjectDeletionService.ts";

/**
 * The hosts' step of a project deletion, core's since #E166 (#Q4099): a
 * deleted project lets go of the hosts lent to it.
 *
 * A project delete from the owner is a SOFT delete, so no foreign key
 * cascades: its loans would keep it among a host's projects. They go, before
 * the project is marked deleted. Ship's step releases its copies and stacks;
 * the hosts the project is the HOME of refuse the deletion instead
 * (`HostHomeGuards`). The Agent hosts that ran its jobs are asked to delete
 * the workspaces those jobs left (#Q4218).
 */
export class HostProjectDeletion {
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly loans = $repository(hostProjects);
  protected readonly jobs = $inject(HostJobService);

  constructor() {
    // The job workspaces its agent jobs left on Agent hosts (#Q4218): every
    // host that ran one is asked to delete them, while the project still
    // has its slug and its jobs.
    this.deletion.registerStep({
      order: 20,
      before: true,
      run: async (projectId) => {
        await this.jobs.removeWorkspaces(projectId);
      },
    });
    this.deletion.registerStep({
      order: 21,
      before: true,
      run: async (projectId) => {
        await this.loans.deleteMany({ projectId: { eq: projectId } });
      },
    });
  }
}
