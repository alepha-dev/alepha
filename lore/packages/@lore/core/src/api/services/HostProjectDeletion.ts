import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { hostProjects } from "../entities/hostProjects.ts";
import { ProjectDeletionService } from "./ProjectDeletionService.ts";

/**
 * The hosts' step of a project deletion, core's since #E166 (#Q4099): a
 * deleted project lets go of the hosts lent to it.
 *
 * A project delete from the owner is a SOFT delete, so no foreign key
 * cascades: its loans would keep it among a host's projects. They go, before
 * the project is marked deleted. Ship's step releases its copies and stacks;
 * the hosts the project is the HOME of refuse the deletion instead
 * (`HostHomeGuards`).
 */
export class HostProjectDeletion {
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly loans = $repository(hostProjects);

  constructor() {
    this.deletion.registerStep({
      order: 21,
      before: true,
      run: async (projectId) => {
        await this.loans.deleteMany({ projectId: { eq: projectId } });
      },
    });
  }
}
