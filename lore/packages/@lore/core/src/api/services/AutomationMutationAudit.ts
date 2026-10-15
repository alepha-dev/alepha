import { $inject } from "alepha";
import { AuditService, audits } from "alepha/api/audits";
import type { UserAccountToken } from "alepha/security";

import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { LoreAudits } from "./LoreAudits.ts";
import { LoreAuditService } from "./LoreAuditService.ts";

/**
 * Configuration evidence joins its native mutation boundary. Metadata contains
 * identities and revisions, never executable prose, credentials or values.
 */
export class AutomationMutationAudit {
  protected readonly service = $inject(AuditService);
  protected readonly rows = $inject(AutomationBatchRepository.of(audits));
  protected readonly audits = $inject(LoreAudits);
  public async activity(
    projectId: number,
    user: UserAccountToken,
    action: string,
  ): Promise<void> {
    if (this.service instanceof LoreAuditService)
      await this.service.nativeActivity({
        scopeType: "project",
        scopeId: String(projectId),
        type: "automation",
        action,
        userId: user.id,
      });
  }
  public statement(
    projectId: number,
    user: UserAccountToken,
    action: string,
    id: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.rows.insertStatement({
      type: this.audits.automation.options.type,
      action,
      ...this.audits.actor(user),
      ...this.audits.scope(projectId),
      resourceType: "automation",
      resourceId: id,
      metadata,
      success: true,
      severity: "info",
    });
  }
}
