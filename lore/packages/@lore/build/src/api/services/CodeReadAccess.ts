import { JobKeyService, ProjectSecurityService } from "@lore/core/api";
import { $inject } from "alepha";
import type { UserAccountToken } from "alepha/security";
import { NotFoundError } from "alepha/server";

import type { CodeRepository } from "../entities/codeRepositories.ts";
import { CodeRepositoryService } from "./CodeRepositoryService.ts";

/**
 * The gate every code read passes (#E167, review #130 item 1), after
 * `$ownsProject` has checked membership and `code:read`: the web pages'
 * actions, the `code_*` tools, the raw download.
 *
 * ⚠️ **A read 404s with Build's `repositories` off**, an exception to
 * Lore's rule that only a capability guards a read: git smart HTTP already
 * answers 404 there (`GitAccessService`), and a code page that still
 * answered over the API would be the same repository through a second
 * door. `apps/lore/test/route-capability-guards.spec.ts` names it.
 *
 * A job key (#Q3995) reads the one repository it is pinned to: any other
 * is a 404, as over git.
 */
export class CodeReadAccess {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly jobKeys = $inject(JobKeyService);
  protected readonly repositories = $inject(CodeRepositoryService);

  /**
   * 404 unless the project has Build with repositories on.
   */
  public async assertRepositories(projectId: number): Promise<void> {
    const set = await this.security.capabilitiesOf(projectId);
    if (!this.security.capabilityOption(set, "build", "repositories")) {
      throw new NotFoundError("Repositories are not enabled for this project");
    }
  }

  /**
   * The repository a caller may read, or a 404.
   */
  public async repository(
    projectId: number,
    slug: string,
    user: UserAccountToken | undefined,
  ): Promise<CodeRepository> {
    await this.assertRepositories(projectId);
    const row = await this.repositories.find(projectId, slug);
    if (!row || !(await this.pinnedTo(row, user))) {
      throw new NotFoundError(`No repository named "${slug}".`);
    }
    return row;
  }

  /**
   * The repositories a caller may read: all of them. A job key's project pin
   * holds it to its project's (#Q4222: no repository pin any more).
   */
  public async readable(
    rows: CodeRepository[],
    _user: UserAccountToken | undefined,
  ): Promise<CodeRepository[]> {
    return rows;
  }

  protected async pinnedTo(
    row: CodeRepository,
    user: UserAccountToken | undefined,
  ): Promise<boolean> {
    const key = await this.jobKeys.scopeOf(user);
    if (!key) return true;
    return !key.revokedAt && key.projectId === row.projectId;
  }
}
