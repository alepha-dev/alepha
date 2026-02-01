import { $audit, type AuditLogOptions } from "alepha/api/audits";

/**
 * Job-specific audit service.
 *
 * Provides type-safe audit logging for job-related events.
 * This service is lazy-loaded when the audits feature is enabled.
 *
 * @example
 * ```ts
 * const jobAudits = alepha.inject(JobAudits);
 * await jobAudits.logTrigger("my-job", { description: "Manually triggered" });
 * ```
 */
export class JobAudits {
  protected readonly audit = $audit({
    type: "job",
    description: "Background job execution events",
    actions: ["trigger", "pause", "resume", "cancel", "schedule_change"],
  });

  /**
   * Log a manual job trigger event.
   */
  public async logTrigger(
    jobName: string,
    options: Omit<AuditLogOptions, "resourceType" | "resourceId"> = {},
  ) {
    await this.audit.log("trigger", {
      ...options,
      resourceType: "job",
      resourceId: jobName,
      description: options.description ?? `Manually triggered job: ${jobName}`,
    });
  }

  /**
   * Log a job pause event.
   */
  public async logPause(
    jobName: string,
    options: Omit<AuditLogOptions, "resourceType" | "resourceId"> = {},
  ) {
    await this.audit.log("pause", {
      ...options,
      resourceType: "job",
      resourceId: jobName,
      description: options.description ?? `Paused job: ${jobName}`,
    });
  }

  /**
   * Log a job resume event.
   */
  public async logResume(
    jobName: string,
    options: Omit<AuditLogOptions, "resourceType" | "resourceId"> = {},
  ) {
    await this.audit.log("resume", {
      ...options,
      resourceType: "job",
      resourceId: jobName,
      description: options.description ?? `Resumed job: ${jobName}`,
    });
  }

  /**
   * Log a job cancellation event.
   */
  public async logCancel(
    jobName: string,
    options: Omit<AuditLogOptions, "resourceType" | "resourceId"> = {},
  ) {
    await this.audit.log("cancel", {
      ...options,
      resourceType: "job",
      resourceId: jobName,
      description: options.description ?? `Cancelled job: ${jobName}`,
    });
  }

  /**
   * Log a job schedule change event.
   */
  public async logScheduleChange(
    jobName: string,
    options: Omit<AuditLogOptions, "resourceType" | "resourceId"> & {
      oldCron?: string;
      newCron?: string;
    } = {},
  ) {
    const { oldCron, newCron, ...rest } = options;
    await this.audit.log("schedule_change", {
      ...rest,
      resourceType: "job",
      resourceId: jobName,
      description: rest.description ?? `Changed schedule for job: ${jobName}`,
      metadata: { oldCron, newCron, ...rest.metadata },
    });
  }
}
