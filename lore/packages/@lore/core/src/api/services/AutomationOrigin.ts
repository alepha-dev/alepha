import { $hook, $inject, Alepha } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationPersistence } from "./AutomationPersistence.ts";

/**
 * A server-only context marker. Job provenance is stored separately from the
 * caller's payload, before its execution row can become dispatchable.
 */
export class AutomationOrigin {
  protected readonly alepha = $inject(Alepha);
  protected readonly persistence = $inject(AutomationPersistence);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly jobs = $repository(jobExecutionEntity);
  protected readonly time = $inject(DateTimeProvider);

  public get current(): AutomationOriginIdentity | undefined {
    return this.alepha.context.get("lore.automations.origin");
  }
  public run<T>(origin: AutomationOriginIdentity, handler: () => T): T {
    return this.alepha.context.nest(() => {
      this.alepha.context.set("lore.automations.origin", origin);
      return handler();
    });
  }
  public async forJob<T>(
    executionId: string,
    handler: () => T,
  ): Promise<Awaited<T>> {
    const marker = await this.marker(executionId);
    return marker
      ? await this.run(
          {
            projectId: marker.projectId,
            automationId: marker.automationId,
            runId: marker.runId,
            operationId: marker.parentId,
          },
          handler,
        )
      : await handler();
  }
  /**
   * Deletes expired origin markers whose job execution is gone, page by page
   * until a page comes back short, at most `pages` pages per call.
   */
  public async prune(pages = 20): Promise<number> {
    return this.database.primary(async () => {
      const now = this.time.nowISOString();
      const orphaned = this.jobs.subquery({
        id: { eq: this.persistence.receipts.table.occurrenceId },
      });
      const where = {
        kind: "job_origin" as const,
        replayUntil: { lt: now },
        notExists: orphaned,
      };
      let pruned = 0;
      for (let page = 0; page < pages; page++) {
        const rows = await this.persistence.receipts.findMany({
          where,
          columns: ["id"],
          orderBy: "replayUntil",
          limit: 50,
        });
        if (!rows.length) break;
        pruned += (
          await this.persistence.receipts.deleteMany({
            ...where,
            id: { inArray: rows.map((row) => row.id) },
          })
        ).length;
        if (rows.length < 50) break;
      }
      return pruned;
    });
  }
  protected marker(executionId: string) {
    return this.database.primary(() =>
      this.persistence.receipts.findOne({
        where: { id: `job-origin:${executionId}`, kind: "job_origin" },
      }),
    );
  }
  protected readonly persist = $hook({
    on: "repository:create:before",
    handler: async ({ tableName, data }) => {
      if (tableName !== "job_executions" || !this.current) return;
      for (const value of Array.isArray(data) ? data : [data]) {
        const row = value as Record<string, unknown>;
        const executionId =
          typeof row.id === "string" ? row.id : crypto.randomUUID();
        row.id = executionId;
        const now = this.time.nowISOString();
        await this.persistence.receipts.create({
          id: `job-origin:${executionId}`,
          identity: `job-origin:${executionId}`,
          kind: "job_origin",
          status: "committed",
          projectId: this.current.projectId,
          automationId: this.current.automationId,
          occurrenceId: executionId,
          ruleRevision: 0,
          runId: this.current.runId,
          parentId: this.current.operationId,
          occurredAt: now,
          replayUntil: this.time.now().add(90, "days").toISOString(),
        });
      }
    },
  });
  protected readonly restore = $hook({
    on: "job:begin",
    handler: async ({ executionId }) => {
      const marker = await this.marker(executionId);
      this.alepha.context.set(
        "lore.automations.origin",
        marker
          ? {
              projectId: marker.projectId,
              automationId: marker.automationId,
              runId: marker.runId,
              operationId: marker.parentId,
            }
          : undefined,
      );
    },
  });
}
export interface AutomationOriginIdentity {
  projectId: number;
  automationId?: string;
  runId?: string;
  operationId?: string;
}
declare module "alepha" {
  interface State {
    "lore.automations.origin"?: AutomationOriginIdentity;
  }
}
