import { ProjectDeletionService } from "@lore/core/api";
import { $inject } from "alepha";

import { CodeRepositoryService } from "./CodeRepositoryService.ts";

/**
 * Build's step of a project deletion (#E162): every repository goes, in the
 * backend and as a row.
 *
 * Explicit rather than a cascade on purpose: `code_repositories.projectId`
 * has none (see the entity), and a project delete from its owner is soft, so
 * no foreign key would fire anyway. Runs before the project row is removed,
 * so a forced (hard) delete never meets the restrictive foreign key.
 */
export class BuildProjectDeletion {
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly repositories = $inject(CodeRepositoryService);

  constructor() {
    this.deletion.registerStep({
      order: 25,
      before: true,
      run: async (projectId) => {
        await this.repositories.deleteAll(projectId);
      },
    });
  }
}
