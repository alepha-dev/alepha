import { Alepha } from "alepha";
import { AlephaApiJobs, jobExecutionEntity } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaSms } from "alepha/sms";
import { describe, expect, it } from "vitest";

import { AdminNotificationController } from "../controllers/AdminNotificationController.ts";
import { AlephaApiNotifications } from "../index.ts";
import { NotificationDeliveryService } from "../services/NotificationDeliveryService.ts";

/**
 * The list has to say, per row, whether Resend can work.
 *
 * The receipt lives 90 days and the outbox row it points at lives 7, so a
 * resend is impossible on most old rows. Without this the action was offered
 * on every row and simply failed on the older half, which reads as a broken
 * button rather than as retention.
 */
class TestAdminController extends AdminNotificationController {
  public listPage(query: Record<string, unknown>) {
    return this.list(query as never);
  }

  public get sendJobName() {
    return this.jobName;
  }
}

class Executions {
  public readonly repo = $repository(jobExecutionEntity);
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaSecurity)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const controller = alepha.inject(TestAdminController);
  const deliveries = alepha.inject(NotificationDeliveryService);
  const executions = alepha.inject(Executions);
  await alepha.start();
  return { alepha, controller, deliveries, executions };
};

const receipt = (executionId: string) => ({
  executionId,
  provider: "MemoryEmailProvider",
  channel: "email" as const,
  contact: "a@example.com",
  template: "t",
  status: "sent" as never,
});

describe("admin notification list - outboxAvailable", () => {
  it("says on each row whether the outbox row is still there", async () => {
    const { alepha, controller, deliveries, executions } = await setup();

    const alive = await executions.repo.create({
      jobName: controller.sendJobName,
      payload: { template: "t" },
    });

    const purged = "3f1c2b7e-5a41-4c2e-9d10-8b6f2a4c7e91";
    await deliveries.record(receipt(alive.id));
    await deliveries.record(receipt(purged));

    const page = await controller.listPage({});
    const byExecution = Object.fromEntries(
      page.content.map((row) => [row.executionId, row.outboxAvailable]),
    );

    expect(byExecution[alive.id]).toBe(true);
    expect(byExecution[purged]).toBe(false);

    await alepha.stop();
  });

  /**
   * `job_executions.id` is a uuid column and the receipt stores its
   * `executionId` as text, so the receipt table can hold a value the outbox
   * could never match. Handing one to `inArray` does not return nothing: it
   * makes Postgres throw `invalid input syntax for type uuid` and takes the
   * whole list down.
   */
  it("survives a receipt whose execution id is not a uuid", async () => {
    const { alepha, controller, deliveries } = await setup();

    await deliveries.record(receipt("legacy-non-uuid-id"));

    const page = await controller.listPage({});
    expect(page.content).toHaveLength(1);
    expect(page.content[0].outboxAvailable).toBe(false);

    await alepha.stop();
  });

  /**
   * An execution id is only unique within the outbox as a whole, and a
   * receipt is not the only thing writing there. A row belonging to another
   * job carries no notification payload, so reporting it as available would
   * offer a resend that cannot work.
   */
  it("does not count an execution belonging to another job", async () => {
    const { alepha, controller, deliveries, executions } = await setup();

    const foreign = await executions.repo.create({
      jobName: "some.other.job",
      payload: { unrelated: true },
    });
    await deliveries.record(receipt(foreign.id));

    const page = await controller.listPage({});
    expect(page.content[0].outboxAvailable).toBe(false);

    await alepha.stop();
  });

  it("issues no outbox query at all for an empty page", async () => {
    // `inArray` throws on an empty array, so the guard is not an
    // optimisation: without it an empty list is an error page.
    const { alepha, controller } = await setup();

    const page = await controller.listPage({});
    expect(page.content).toHaveLength(0);

    await alepha.stop();
  });
});
