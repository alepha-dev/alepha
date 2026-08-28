import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaSms } from "alepha/sms";
import { describe, expect, it } from "vitest";

import { AdminNotificationController } from "../controllers/AdminNotificationController.ts";
import { notificationDeliveryEntity } from "../entities/notificationDeliveryEntity.ts";
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

const receipt = (
  executionId: string,
  status: string,
  extra: Record<string, unknown> = {},
) => ({
  executionId,
  provider: "MemoryEmailProvider",
  channel: "email" as const,
  contact: "a@example.com",
  template: "t",
  status: status as never,
  ...extra,
});

describe("admin notification list — status filter", () => {
  it("only accepts statuses a receipt actually carries", () => {
    const values = (notificationQuerySchema.shape.status as any).unwrap()
      .options as string[];

    // Compared against the ENTITY, not against a hand-kept list. A filter
    // option the backend can never produce is a dead entry in the admin
    // dropdown, and a status the entity gains without the filter is a state
    // an operator cannot search for.
    //
    // This is also the first half of a chain: the admin UI derives its own
    // status vocabulary from this query schema (the entity itself is not
    // exported to the browser), and `admin-status-labels.browser.spec.tsx`
    // asserts the second half.
    const entityValues = (notificationDeliveryEntity.schema.shape.status as any)
      .options as string[];

    expect([...values].sort()).toEqual([...entityValues].sort());
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

/**
 * Status was the only filter the list had, which made it useless on anything
 * but a toy dataset: an operator looking for one message had to page through
 * ninety days of receipts.
 */
describe("admin notification list - filters", () => {
  it("filters on the contact, case-insensitively", async () => {
    const { alepha, controller, deliveries } = await setup();

    await deliveries.record(
      receipt("e-1", "sent", { contact: "Ada@Example.com" }),
    );
    await deliveries.record(
      receipt("e-2", "sent", { contact: "bob@example.com" }),
    );

    const page = await controller.listPage({ search: "ada@" });
    expect(page.content).toHaveLength(1);
    expect(page.content[0].contact).toBe("Ada@Example.com");

    await alepha.stop();
  });

  it("filters on template, channel and category", async () => {
    const { alepha, controller, deliveries } = await setup();

    await deliveries.record(
      receipt("e-1", "sent", { template: "welcome", category: "onboarding" }),
    );
    await deliveries.record(
      receipt("e-2", "sent", { template: "invoice", category: "billing" }),
    );
    await deliveries.record(
      receipt("e-3", "sent", { template: "welcome", channel: "sms" }),
    );

    expect(
      (await controller.listPage({ template: "welcome" })).content,
    ).toHaveLength(2);
    expect(
      (await controller.listPage({ channel: "sms" })).content,
    ).toHaveLength(1);
    expect(
      (await controller.listPage({ category: "billing" })).content,
    ).toHaveLength(1);

    await alepha.stop();
  });

  it("splits rows that carry an error from rows that do not", async () => {
    const { alepha, controller, deliveries } = await setup();

    await deliveries.record(receipt("e-1", "failed", { error: "boom" }));
    await deliveries.record(receipt("e-2", "sent"));

    expect(
      (await controller.listPage({ hasError: true })).content,
    ).toHaveLength(1);
    // `false` is a real filter (rows with no error), not "no filter", so it
    // has to be checked against undefined rather than for truthiness.
    expect(
      (await controller.listPage({ hasError: false })).content,
    ).toHaveLength(1);

    await alepha.stop();
  });

  /**
   * The case a naive implementation breaks. Two separate `where.createdAt`
   * assignments have the second overwrite the first, so a range silently
   * becomes one-sided - and a test that only ever passes one bound still
   * goes green.
   */
  it("applies both ends of a created range at once", async () => {
    const { alepha, controller, deliveries } = await setup();

    await deliveries.record(receipt("e-1", "sent"));

    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

    const inside = await controller.listPage({
      createdAfter: iso(-60_000),
      createdBefore: iso(60_000),
    });
    expect(inside.content).toHaveLength(1);

    const after = await controller.listPage({
      createdAfter: iso(60_000),
      createdBefore: iso(120_000),
    });
    expect(after.content).toHaveLength(0);

    const before = await controller.listPage({
      createdAfter: iso(-120_000),
      createdBefore: iso(-60_000),
    });
    expect(before.content).toHaveLength(0);

    await alepha.stop();
  });
});
