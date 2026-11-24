import { AgentAutomationKinds, ProjectSecurityService } from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { projectErrors } from "../entities/projectErrors.ts";

/**
 * Ship's half of a triage automation's "only if there is something" check
 * (#Q4228): an open trusted error group (#Q4233; a server one is trusted on
 * arrival, #Q4255), when the project tracks errors (Ship's `track` option).
 * An untrusted group is no work: no agent reads it.
 */
export class ShipAutomationWork {
  protected readonly kinds = $inject(AgentAutomationKinds);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly errors = $repository(projectErrors);

  constructor() {
    this.kinds.registerWork("triage", (automation) =>
      this.trustedOpenErrors(automation.projectId),
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
