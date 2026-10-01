import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaSms } from "alepha/sms";
import { describe, expect, it } from "vitest";

import { AdminNotificationController } from "../controllers/AdminNotificationController.ts";
import { AlephaApiNotifications } from "../index.ts";
import { $notification } from "../primitives/$notification.ts";

/**
 * The filter bar needs the catalogue of what this app can send, not the
 * distinct values already in the receipts table: a template nobody has sent
 * yet is still a legitimate thing to filter on, and a DISTINCT over ninety
 * days of receipts is an unindexed scan.
 */
class TestAdminController extends AdminNotificationController {
  public listTemplates() {
    return this.templates();
  }
}

class Templates {
  readonly welcome = $notification({
    name: "welcome",
    category: "onboarding",
    description: "Sent once, on signup.",
    schema: z.object({ username: z.text() }),
    email: {
      subject: "Welcome",
      body: (v) => `<p>Hi ${v.username}</p>`,
    },
  });

  readonly reset = $notification({
    name: "reset",
    critical: true,
    sensitive: true,
    schema: z.object({ link: z.text() }),
    email: { subject: "Reset", body: (v) => v.link },
    sms: { message: (v) => v.link },
  });
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
  alepha.inject(Templates);
  await alepha.start();
  return { alepha, controller };
};

describe("admin notification templates", () => {
  it("lists the registered templates with their channels and flags", async () => {
    const { alepha, controller } = await setup();

    const templates = controller.listTemplates();
    const byName = Object.fromEntries(templates.map((t) => [t.name, t]));

    expect(byName.welcome.category).toBe("onboarding");
    expect(byName.welcome.description).toBe("Sent once, on signup.");
    expect(byName.welcome.channels).toEqual(["email"]);
    expect(byName.welcome.critical).toBe(false);
    expect(byName.welcome.sensitive).toBe(false);

    expect(byName.reset.channels).toEqual(["email", "sms"]);
    expect(byName.reset.critical).toBe(true);
    expect(byName.reset.sensitive).toBe(true);

    await alepha.stop();
  });

  /**
   * The variable schema belongs to the deferred create-from-template form.
   * Shipping it here would publish every template's variable names to
   * anyone holding `admin:notification:read`, which a filter dropdown has no
   * reason to pay for.
   */
  it("does not leak the variable schema", async () => {
    const { alepha, controller } = await setup();

    const templates = controller.listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((t) => !("schema" in t))).toBe(true);

    await alepha.stop();
  });
});
