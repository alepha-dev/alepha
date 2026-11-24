import { ProjectSecurityService, PromptRegistry } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";

/**
 * Ship's `errors` check of a prompt's trigger (#Q4277, from the automations'
 * "only if there is something", #Q4228): an open trusted error group
 * (#Q4233; a server one is trusted on arrival, #Q4255), when the project
 * tracks errors (Ship's `track` option). An untrusted group is no work: no
 * agent reads it.
 */
export class ShipPromptChecks {
  protected readonly registry = $inject(PromptRegistry);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly errors = $repository(projectErrors);

  constructor() {
    this.registry.registerCheck("errors", (projectId) =>
      this.trustedOpenErrors(projectId),
    );
  }

  public async trustedOpenErrors(projectId: number): Promise<boolean> {
    const tracks = this.security.capabilityOption(
      await this.security.capabilitiesOf(projectId),
      "ship",
      "track",
    );
    if (!tracks) return false;
    const open = await this.errors.findOne({
      where: {
        projectId: { eq: projectId },
        status: { eq: "open" },
        trustedAt: { isNotNull: true },
      },
    });
    return Boolean(open);
  }
}
