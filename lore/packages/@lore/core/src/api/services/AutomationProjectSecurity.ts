import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * Execution can span several effects and isolates. Configuration TTLs and an
 * HTTP request memo are not a revocation boundary for a stored program.
 */
export class AutomationProjectSecurity extends ProjectSecurityService {
  public override capabilityRowsOf(projectId: number) {
    return this.capabilities.findMany({ where: { projectId } });
  }
}
