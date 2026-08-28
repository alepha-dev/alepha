import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaSms } from "alepha/sms";
import { describe, expect, it } from "vitest";

import { AdminNotificationController } from "../controllers/AdminNotificationController.ts";
import { AlephaApiNotifications } from "../index.ts";
import { notificationQuerySchema } from "../schemas/notificationQuerySchema.ts";
import { NotificationDeliveryService } from "../services/NotificationDeliveryService.ts";

/**
 * The admin list declared a `status` query parameter and never applied it, so
 * every filter returned the unfiltered page.
 *
 * Its vocabulary has now moved twice. It was once a fiction (`retrying` /
 * `completed` / `dead`), then the `job_executions` statuses, and it is now
 * the **delivery receipt** statuses: the list is backed by
 * `notification_deliveries`, because "the provider accepted it" is not the
 * question an operator asks about a message.
 */
class TestAdminController extends AdminNotificationController {
  public listPage(query: Record<string, unknown>) {
    return this.list(query as never);
  }
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
  await alepha.start();
  return { alepha, controller, deliveries };
};

const receipt = (executionId: string, status: string) => ({
  executionId,
  provider: "MemoryEmailProvider",
  channel: "email" as const,
  contact: "a@example.com",
  template: "t",
  status: status as never,
});

describe("admin notification list — status filter", () => {
  it("only accepts statuses a receipt actually carries", () => {
    const values = (notificationQuerySchema.shape.status as any).unwrap()
      .options as string[];

    // A filter option the backend can never produce is a dead entry in the
    // admin dropdown.
    expect([...values].sort()).toEqual(
      [
        "sent",
        "delivered",
        "deferred",
        "bounced",
        "complained",
        "failed",
        "rejected",
        "skipped",
      ].sort(),
    );
  });

  it("applies the status filter to the query", async () => {
    const { alepha, controller, deliveries } = await setup();

    await deliveries.record(receipt("e-1", "sent"));
    await deliveries.record(receipt("e-2", "sent"));
    await deliveries.record(receipt("e-3", "bounced"));

    const bounced = await controller.listPage({ status: "bounced" });
    expect(bounced.content).toHaveLength(1);
    expect(bounced.content[0].status).toBe("bounced");

    const sent = await controller.listPage({ status: "sent" });
    expect(sent.content).toHaveLength(2);

    await alepha.stop();
  });

  it("returns every notification when no status is given", async () => {
    const { alepha, controller, deliveries } = await setup();

    await deliveries.record(receipt("e-1", "sent"));
    await deliveries.record(receipt("e-2", "failed"));

    const all = await controller.listPage({});
    expect(all.content).toHaveLength(2);

    await alepha.stop();
  });
});
