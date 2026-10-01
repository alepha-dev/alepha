import { Alepha, z } from "alepha";
import { AlephaApiJobs, jobExecutionEntity } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaSms } from "alepha/sms";
import { describe, expect, it } from "vitest";

import { AdminNotificationController } from "../controllers/AdminNotificationController.ts";
import { AlephaApiNotifications } from "../index.ts";
import { $notification } from "../primitives/$notification.ts";
import { notificationPreviewResourceSchema } from "../schemas/notificationPreviewResourceSchema.ts";
import { NotificationDeliveryService } from "../services/NotificationDeliveryService.ts";

/**
 * The preview re-renders the message from its template rather than reading a
 * stored body: `storeRenderedBody` is off by default, so most receipts carry
 * no body at all and a stored-only preview would be blank for nearly every
 * app.
 *
 * That choice is what makes the three unavailable states real, and all three
 * are expected outcomes rather than errors - which is why this returns 200
 * with a reason instead of a 403 or a 404.
 */
class TestAdminController extends AdminNotificationController {
  public previewOne(id: string) {
    return this.preview(id);
  }

  public get sendJobName() {
    return this.jobName;
  }
}

class Templates {
  readonly welcome = $notification({
    name: "pv-welcome",
    category: "onboarding",
    schema: z.object({ username: z.text() }),
    email: {
      subject: "Welcome",
      body: (v) => `<p>Hi ${v.username}</p>`,
    },
  });

  readonly code = $notification({
    name: "pv-code",
    schema: z.object({ code: z.text() }),
    sms: { message: (v) => `Your code is ${v.code}` },
  });

  /**
   * A body of realistic size. Every real email is far over the 255 characters
   * a bare `z.text()` allows.
   */
  readonly long = $notification({
    name: "pv-long",
    schema: z.object({ title: z.text() }),
    email: {
      subject: "A long one",
      body: (v) => `<h1>${v.title}</h1>${"<p>Body copy.</p>".repeat(500)}`,
    },
  });
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
  alepha.inject(Templates);
  await alepha.start();

  /**
   * Write one outbox row plus the receipt that settles it, and hand back the
   * receipt id the admin would click on.
   */
  const sent = async (
    payload: { template: string; contact: string } & Record<string, unknown>,
    options: { channel?: "email" | "sms" } = {},
  ) => {
    const exec = await executions.repo.create({
      jobName: controller.sendJobName,
      payload,
    });
    await deliveries.record({
      executionId: exec.id,
      provider: "MemoryEmailProvider",
      channel: options.channel ?? "email",
      contact: payload.contact,
      template: payload.template,
      status: "sent",
    });
    return await deliveries.findByExecutionId(exec.id);
  };

  return { alepha, controller, deliveries, executions, sent };
};

const emailPayload = (extra: Record<string, unknown> = {}) => ({
  type: "email",
  template: "pv-welcome",
  contact: "ada@example.com",
  variables: { username: "Ada" },
  category: "onboarding",
  ...extra,
});

describe("admin notification preview", () => {
  it("re-renders the email from the template", async () => {
    const { alepha, controller, sent } = await setup();

    const receipt = await sent(emailPayload());
    const preview = await controller.previewOne(receipt!.id);

    expect(preview.available).toBe(true);
    expect(preview.channel).toBe("email");
    expect(preview.subject).toBe("Welcome");
    expect(preview.body).toContain("Hi Ada");
    expect(preview.source).toBe("live");

    await alepha.stop();
  });

  /**
   * The bug this exists for, found by opening the page rather than by any
   * test here: the body field was a bare `z.text()`, which caps at 255 characters
   * (`Z_LIMITS.regular`). Calling the handler directly never crosses the
   * route, so every assertion above passed while the real endpoint rejected
   * its own response and the Preview tab rendered blank behind a
   * "Too big: expected string to have..." toast.
   *
   * Validating against the schema is what makes this a route-level test
   * without standing up a server.
   */
  it("produces a response the route's own schema accepts", async () => {
    const { alepha, controller, sent } = await setup();

    const receipt = await sent(
      emailPayload({
        template: "pv-long",
        variables: { title: "Release notes" },
      }),
    );
    const preview = await controller.previewOne(receipt!.id);

    expect(preview.body!.length).toBeGreaterThan(5_000);
    expect(() =>
      alepha.codec.validate(notificationPreviewResourceSchema, preview),
    ).not.toThrow();

    await alepha.stop();
  });

  it("re-renders an sms as its message text", async () => {
    const { alepha, controller, sent } = await setup();

    const receipt = await sent(
      {
        type: "sms",
        template: "pv-code",
        contact: "+33600000000",
        variables: { code: "123456" },
      },
      { channel: "sms" },
    );
    const preview = await controller.previewOne(receipt!.id);

    expect(preview.available).toBe(true);
    expect(preview.channel).toBe("sms");
    expect(preview.body).toBe("Your code is 123456");
    // One flat shape, whatever the channel: an sms simply has no subject,
    // rather than a separate `message` key the UI has to switch on.
    expect(preview.subject).toBeUndefined();

    await alepha.stop();
  });

  /**
   * Same rule `toDetailResource` applies to `variables`. Without it the
   * `sensitive` flag is decorative: a password reset link would be readable
   * after the fact by anyone holding `admin:notification:read`.
   */
  it("refuses a sensitive template instead of rendering it", async () => {
    const { alepha, controller, sent } = await setup();

    const receipt = await sent(emailPayload({ sensitive: true }));
    const preview = await controller.previewOne(receipt!.id);

    expect(preview.available).toBe(false);
    expect(preview.reason).toBe("sensitive");
    expect(preview.body).toBeUndefined();
    expect(preview.subject).toBeUndefined();

    await alepha.stop();
  });

  it("says the outbox row is gone rather than erroring", async () => {
    const { alepha, controller, deliveries } = await setup();

    await deliveries.record({
      executionId: crypto.randomUUID(),
      provider: "MemoryEmailProvider",
      channel: "email",
      contact: "ada@example.com",
      template: "pv-welcome",
      status: "sent",
    });
    const page = await deliveries.list({});
    const preview = await controller.previewOne(page[0].id);

    expect(preview.available).toBe(false);
    expect(preview.reason).toBe("outbox-purged");

    await alepha.stop();
  });

  it("says the template is gone when nothing registers it any more", async () => {
    const { alepha, controller, sent } = await setup();

    const receipt = await sent(emailPayload({ template: "deleted-template" }));
    const preview = await controller.previewOne(receipt!.id);

    expect(preview.available).toBe(false);
    expect(preview.reason).toBe("template-missing");

    await alepha.stop();
  });

  /**
   * `renderEmail` resolves attachment bytes from storage and throws on a
   * missing object. A preview needs the picture, not the bytes, and a
   * purged attachment must not turn it into a 500.
   */
  it("previews a notification whose attachment no longer exists", async () => {
    const { alepha, controller, sent } = await setup();

    const fileId = crypto.randomUUID();
    const receipt = await sent(
      emailPayload({
        attachments: [{ storage: "does-not-exist", fileId }],
      }),
    );
    const preview = await controller.previewOne(receipt!.id);

    expect(preview.available).toBe(true);
    expect(preview.body).toContain("Hi Ada");
    expect(preview.attachments).toEqual([fileId]);

    await alepha.stop();
  });
});
