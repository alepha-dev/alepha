import { $inject, Alepha, AlephaError } from "alepha";
import { JobProvider, jobExecutionEntity } from "alepha/api/jobs";
import {
  notificationDeliveryEntity,
  type NotificationDeliveryEntity,
  NotificationJobs,
  NotificationSenderService,
} from "alepha/api/notifications";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { automationReceipts } from "../entities/automationReceipts.ts";
import { AutomationBatchRepository } from "./AutomationBatchRepository.ts";
import { AutomationDatabase } from "./AutomationDatabase.ts";
import { AutomationNotificationSender } from "./AutomationNotificationSender.ts";

/**
 * Narrow enqueue seam for the existing notification job. Its registration
 * supplies schema and retry policy; its normal dispatcher, sweep, preferences,
 * suppressions, receipts and transports remain responsible for delivery.
 */
export class AutomationNotificationOutbox {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly jobs = $inject(JobProvider);
  protected readonly notificationJobs = $inject(NotificationJobs);
  protected readonly database = $inject(AutomationDatabase);
  protected readonly time = $inject(DateTimeProvider);
  protected readonly deliveries = $repository(notificationDeliveryEntity);
  protected readonly receipts = $repository(automationReceipts);
  protected readonly executions = $inject(
    AutomationBatchRepository.of(jobExecutionEntity),
  );
  protected readonly log = $logger();

  public prepare(input: {
    projectId: number;
    automationId: string;
    runId?: string;
    operationId?: string;
    payload: unknown;
    key: string;
  }) {
    if (
      !(
        this.alepha.inject(NotificationSenderService) instanceof
        AutomationNotificationSender
      )
    )
      throw new AlephaError(
        "Automation outbox requires the current-author notification sender",
      );
    const name = this.notificationJobs.sendNotification.name;
    const registration = this.jobs.getRegisteredJobs().get(name);
    if (
      !registration ||
      registration.kind !== "queue" ||
      !registration.options.schema
    )
      throw new AlephaError("Notification outbox job is unavailable");
    const payload = this.alepha.codec.validate(
      registration.options.schema,
      input.payload,
    );
    const id = this.crypto.randomUUID();
    const now = this.time.nowISOString();
    const marker = `job-origin:${id}`;
    return {
      id,
      statements: [
        this.receipts.insertStatement({
          id: marker,
          projectId: input.projectId,
          automationId: input.automationId,
          runId: input.runId,
          parentId: input.operationId,
          identity: marker,
          kind: "job_origin",
          status: "committed",
          occurrenceId: id,
          ruleRevision: 0,
          occurredAt: now,
          replayUntil: this.time.now().add(90, "days").toISOString(),
          cursor: 0,
          queueAttempts: 0,
          rosterComplete: false,
          createdAt: now,
          updatedAt: now,
        }),
        this.executions.insertStatement({
          id,
          createdAt: now,
          updatedAt: now,
          jobName: name,
          key: input.key,
          status: "pending",
          attempt: 0,
          maxAttempts: (registration.options.retry?.retries ?? 0) + 1,
          redispatchCount: 0,
          payload: payload as Record<string, unknown>,
        }),
      ],
      changedTables: ["job_executions", "automation_receipts"],
    };
  }

  public async dispatch(id: string): Promise<void> {
    const row = await this.executions.findById(id);
    if (row?.status !== "pending") return;
    try {
      await this.jobs.dispatcher.dispatch(row.jobName, id);
    } catch {
      // The durable pending row is the sweep's recovery witness. Never turn
      // a lost dispatch acknowledgement into another notification enqueue.
      this.log.warn(
        "Automation notification dispatch deferred to the job sweep",
        { executionId: id },
      );
    }
  }

  public async status(id: string) {
    return (await this.statuses([id])).get(id)!;
  }

  public async statuses(ids: string[]) {
    if (ids.length > 100)
      throw new AlephaError(
        "Notification outcome reads are limited to 100 executions",
      );
    return this.database.primary(async () => {
      const unique = [...new Set(ids)];
      if (!unique.length)
        return new Map<
          string,
          ReturnType<AutomationNotificationOutbox["outcome"]>
        >();
      const [receipts, executions] = await Promise.all([
        this.deliveries.findMany({
          where: { executionId: { inArray: unique } },
        }),
        this.executions.findMany({
          where: { id: { inArray: unique } },
          columns: ["id", "status"],
        }),
      ]);
      const receiptById = new Map(
        receipts.map((row) => [row.executionId, row]),
      );
      const executionById = new Map(executions.map((row) => [row.id, row]));
      return new Map(
        unique.map((id) => [
          id,
          this.outcome(executionById.get(id), receiptById.get(id)),
        ]),
      );
    });
  }

  protected outcome(
    execution: { status: string } | undefined,
    receipt: NotificationDeliveryEntity | undefined,
  ) {
    if (
      execution &&
      ["pending", "running", "scheduled"].includes(execution.status)
    )
      return {
        status: "queued" as const,
        ...(receipt ? { lastAttempt: receipt.status } : {}),
      };
    if (receipt)
      return {
        status:
          receipt.channel === "inbox" && receipt.status === "sent"
            ? ("delivered" as const)
            : receipt.status,
        receiptId: receipt.id,
        ...(receipt.messageId ? { messageId: receipt.messageId } : {}),
        ...(receipt.skipReason ? { reason: receipt.skipReason } : {}),
      };
    return {
      status:
        execution?.status === "error" || execution?.status === "cancelled"
          ? ("failed" as const)
          : ("unknown" as const),
    };
  }
}
