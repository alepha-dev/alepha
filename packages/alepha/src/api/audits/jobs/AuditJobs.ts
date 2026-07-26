import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { AuditParameters } from "../parameters/AuditParameters.ts";
import { AuditService } from "../services/AuditService.ts";

/**
 * Scheduled enforcement of the audit retention policy.
 */
export class AuditJobs {
  protected readonly auditService = $inject(AuditService);
  protected readonly auditParameters = $inject(AuditParameters);

  /**
   * Delete audit entries that have outlived their retention window.
   *
   * Runs daily and applies each audit type's dedicated `retentionDays` plus the
   * global default (`auditOptions.retentionDays`). A default of `0` disables
   * cleanup for types without a dedicated retention.
   */
  public readonly cleanExpired = $job({
    name: "api:audits:cleanExpired",
    cron: "0 3 * * *", // Daily at 03:00
    description: "Delete expired audit entries (retention policy)",
    handler: async ({ now }) => {
      const defaultRetentionDays = this.auditParameters.get("retentionDays");
      await this.auditService.deleteExpired(now.toDate(), defaultRetentionDays);
    },
  });
}
