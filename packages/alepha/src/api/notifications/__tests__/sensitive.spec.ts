import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaSms } from "alepha/sms";
import { describe, expect, it } from "vitest";

import { AdminNotificationController } from "../controllers/AdminNotificationController.ts";
import type { NotificationDeliveryEntity } from "../entities/notificationDeliveryEntity.ts";
import { AlephaApiNotifications } from "../index.ts";

/**
 * Exposes the protected projection so the redaction contract can be asserted
 * without standing up an authenticated HTTP request.
 */
class TestAdminController extends AdminNotificationController {
  public detail(
    receipt: NotificationDeliveryEntity,
    exec?: Record<string, unknown>,
  ) {
    return this.toDetailResource(receipt, exec);
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
  await alepha.start();
  return controller;
};

/**
 * A receipt for a sensitive template already carries no subject and no body:
 * the sender withholds them at write time. What this spec pins is the second
 * half of the contract, that `variables` from the still-present outbox row
 * are withheld too.
 */
const receipt = (sensitive: boolean): NotificationDeliveryEntity => ({
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
  executionId: "exec-1",
  provider: "MemoryEmailProvider",
  channel: "email",
  contact: "a@example.com",
  template: "password-reset",
  critical: true,
  status: "sent",
  subject: sensitive ? null : "Reset your password",
  body: null,
});

const execution = (sensitive: boolean) => ({
  id: "n-1",
  status: "ok",
  logs: [],
  payload: {
    name: "password-reset",
    sensitive,
    variables: { resetLink: "https://app/reset?token=SECRET", code: "123456" },
  },
});

describe("notification `sensitive` flag", () => {
  it("withholds rendered variables for a sensitive template", async () => {
    const controller = await setup();

    // `variables` hold rendered personal data (reset links, codes). Anyone
    // with admin:notification:read could otherwise read them after the fact.
    const detail = controller.detail(receipt(true), execution(true));
    expect(detail.variables).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain("SECRET");
    expect(JSON.stringify(detail)).not.toContain("123456");
  });

  it("still exposes variables for a non-sensitive template", async () => {
    const controller = await setup();

    const detail = controller.detail(receipt(false), execution(false));
    expect(detail.variables).toEqual({
      resetLink: "https://app/reset?token=SECRET",
      code: "123456",
    });
  });
});
