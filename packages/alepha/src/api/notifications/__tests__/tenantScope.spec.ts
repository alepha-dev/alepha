import { Alepha, AlephaError } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  AlephaSecurity,
  currentTenantAtom,
  tenancyAtom,
} from "alepha/security";
import { AlephaSms } from "alepha/sms";
import { describe, expect, it } from "vitest";

import { AdminNotificationController } from "../controllers/AdminNotificationController.ts";
import { AlephaApiNotifications } from "../index.ts";
import { NotificationDeliveryService } from "../services/NotificationDeliveryService.ts";

/**
 * Neither `job_executions` nor `notification_deliveries` is an org-scoped
 * entity, so the ORM's own fail-closed guard never fires on them: this
 * controller's own checks are the whole gate. They were once written as
 * `if (org) { filter }`, which turns an unresolved tenant into *no filter* -
 * on a pooled multi-tenant worker, an admin reading and deleting every
 * tenant's notifications.
 *
 * The list moved from the outbox to the receipts in #1269. The gate did not,
 * and this suite is what says so.
 */
class TestAdminController extends AdminNotificationController {
  public listPage(query: Record<string, unknown>) {
    return this.list(query as never);
  }
  public isSameTenant(exec: { organizationId?: string | null }) {
    return this.sameTenant(exec);
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

  let n = 0;
  const seed = async (organizationId?: string) => {
    n += 1;
    await deliveries.record({
      executionId: `exec-${n}`,
      organizationId: organizationId ?? null,
      provider: "MemoryEmailProvider",
      channel: "email",
      contact: "a@example.com",
      template: "welcome",
      status: "sent",
    });
  };

  return { alepha, controller, seed };
};

const ORG_A = "a0000000-0000-0000-0000-000000000001";
const ORG_B = "b0000000-0000-0000-0000-000000000002";

describe("admin notification list — tenant scope", () => {
  it("single-tenant: no tenant resolved, everything is this app's", async () => {
    const { controller, seed } = await setup();
    await seed();
    await seed();

    const page = await controller.listPage({});
    expect(page.content).toHaveLength(2);
    expect(controller.isSameTenant({ organizationId: null })).toBe(true);
  });

  it("multi-tenant: refuses to list with no resolved tenant", async () => {
    const { alepha, controller, seed } = await setup();
    await seed(ORG_A);
    await seed(ORG_B);

    alepha.store.set(tenancyAtom, { mode: "multi" });

    // The regression this closes: without a tenant, the org filter used to be
    // dropped and this returned both tenants' rows.
    await expect(controller.listPage({})).rejects.toThrowError(AlephaError);
  });

  it("multi-tenant: refuses the per-row check with no resolved tenant", async () => {
    const { alepha, controller } = await setup();
    alepha.store.set(tenancyAtom, { mode: "multi" });

    expect(() => controller.isSameTenant({ organizationId: ORG_A })).toThrow(
      AlephaError,
    );
  });

  it("multi-tenant: a resolved tenant sees only its own rows", async () => {
    const { alepha, controller, seed } = await setup();
    await seed(ORG_A);
    await seed(ORG_B);
    await seed(ORG_B);

    alepha.store.set(tenancyAtom, { mode: "multi" });
    alepha.store.set(currentTenantAtom, { id: ORG_A });

    const page = await controller.listPage({});
    expect(page.content).toHaveLength(1);
    expect(controller.isSameTenant({ organizationId: ORG_A })).toBe(true);
    expect(controller.isSameTenant({ organizationId: ORG_B })).toBe(false);
  });
});
