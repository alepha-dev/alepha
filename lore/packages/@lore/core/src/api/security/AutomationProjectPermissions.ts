import { $inject } from "alepha";

import { AutomationProjectSecurity } from "../services/AutomationProjectSecurity.ts";
import { AutomationRanks } from "../services/AutomationRanks.ts";
import { ProjectPermissions } from "./ProjectPermissions.ts";

/**
 * The existing grant intersection, with fresh automation-specific readers.
 */
export class AutomationProjectPermissions extends ProjectPermissions {
  protected override readonly projectSecurity = $inject(
    AutomationProjectSecurity,
  );
  protected override readonly ranks = $inject(AutomationRanks);
}
