import { Alepha, z } from "alepha";
import { AlephaApiJobs, jobExecutionEntity } from "alepha/api/jobs";
import {
  $notification,
  AdminNotificationController,
  AlephaApiNotifications,
  NotificationDeliveryService,
  NotificationSenderService,
} from "alepha/api/notifications";
import { AlephaEmail } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  AlephaDiscordNotifications,
  DiscordTransport,
  discordOptions,
  MemoryDiscordTransport,
} from "../index.ts";

const ALERTS = "https://discord.com/api/webhooks/1234567890/abcDEF-ghi_JKL";
const RELEASES = "https://discord.com/api/webhooks/9876543210/zyxWVU-tsr_QPO";

class Templates {
  readonly shipped = $notification({
    name: "dc-shipped",
    category: "releases",
    schema: z.object({ tag: z.text() }),
    discord: { to: "releases", message: (v) => `shipped ${v.tag}` },
  });

  readonly incident = $notification({
    name: "dc-incident",
    category: "ops",
    schema: z.object({ what: z.text() }),
    discord: { message: (v) => `incident: ${v.what}` },
  });

  readonly secret = $notification({
    name: "dc-secret",
    sensitive: true,
    schema: z.object({ code: z.text() }),
    discord: { to: "alerts", message: (v) => `code ${v.code}` },
  });
}

/**
 * A controller subclass, because `preview()` is protected: the point of the
 * assertion is what an operator can read back, and the route's own handler
 * is what answers it.
 */
class TestAdminController extends AdminNotificationController {
  public previewOne(id: string) {
    return this.preview(id);
  }

  public get sendJobName() {
    return this.jobName;
  }
}

class Executions {
  public readonly repo = $repository(jobExecutionEntity);
}

const boot = async (options?: {
  destinations?: Record<string, unknown>;
  templates?: boolean;
}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    // Before the module, so the memory transport wins the `optional`
    // substitution `AlephaDiscordNotifications` declares.
    .with({ provide: DiscordTransport, use: MemoryDiscordTransport })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications)
    .with(AlephaDiscordNotifications);

  alepha.set(discordOptions, {
    destinations: (options?.destinations ?? {
      alerts: { webhook: ALERTS, default: true, username: "alepha" },
      releases: { webhook: RELEASES },
    }) as never,
  });

  const templates =
    options?.templates === false ? undefined : alepha.inject(Templates);

  return { alepha, templates };
};

const started = async (options?: Parameters<typeof boot>[0]) => {
  const { alepha, templates } = await boot(options);
  await alepha.start();
  return {
    alepha,
    templates: templates!,
    transport: alepha.inject(MemoryDiscordTransport),
    sender: alepha.inject(NotificationSenderService),
    deliveries: alepha.inject(NotificationDeliveryService),
  };
};

describe("DiscordNotificationChannel", () => {
  it("posts to the destination the template names", async ({ expect }) => {
    const { alepha, templates, transport } = await started();

    await templates.shipped.push({
      variables: { tag: "v1.2.3" },
      inline: true,
    });

    expect(transport.posts).toHaveLength(1);
    expect(transport.wasPostedTo(RELEASES)).toBe(true);
    expect(transport.last()?.payload.content).toBe("shipped v1.2.3");

    await alepha.stop();
  });

  it("falls back to the destination flagged default", async ({ expect }) => {
    const { alepha, templates, transport } = await started();

    await templates.incident.push({
      variables: { what: "disk full" },
      inline: true,
    });

    expect(transport.wasPostedTo(ALERTS)).toBe(true);
    // The destination's own username overrides the webhook's.
    expect(transport.last()?.payload.username).toBe("alepha");

    await alepha.stop();
  });

  /**
   * A sink has no recipient, so the receipt's NOT NULL `contact` column
   * carries what the channel says it reached. The webhook is not it.
   */
  it("records channel:destination on the receipt, never the webhook", async ({
    expect,
  }) => {
    const { alepha, deliveries, sender } = await started();

    await sender.send(
      {
        type: "discord",
        template: "dc-shipped",
        variables: { tag: "v2" },
        category: "releases",
      },
      { executionId: "dc-exec-1" },
    );

    const [receipt] = await deliveries.list({});
    expect(receipt.contact).toBe("discord:releases");
    expect(receipt.channel).toBe("discord");
    expect(JSON.stringify(receipt)).not.toContain(RELEASES);

    await alepha.stop();
  });

  /**
   * The preview returns `NotificationRendered`'s base fields, so the webhook
   * a plugin carries in its own channel-private `R` cannot reach an operator
   * holding `admin:notification:read`.
   */
  it("keeps the webhook out of the admin preview", async ({ expect }) => {
    const { alepha } = await boot();
    const controller = alepha.inject(TestAdminController);
    const deliveries = alepha.inject(NotificationDeliveryService);
    const executions = alepha.inject(Executions);
    await alepha.start();

    // A real outbox row, so the preview actually RE-RENDERS through this
    // channel rather than reporting the row as purged. Without it the
    // assertion below would pass against an empty answer.
    const exec = await executions.repo.create({
      jobName: controller.sendJobName,
      payload: {
        type: "discord",
        template: "dc-shipped",
        variables: { tag: "v3" },
      },
    });
    await deliveries.record({
      executionId: exec.id,
      provider: "DiscordNotificationChannel",
      channel: "discord",
      contact: "discord:releases",
      template: "dc-shipped",
      status: "sent",
    });
    const receipt = await deliveries.findByExecutionId(exec.id);

    const preview = await controller.previewOne(receipt!.id);

    expect(preview.available).toBe(true);
    expect(preview.body).toBe("shipped v3");
    // The channel carries the resolved webhook in its own `R`, and the
    // controller returns `NotificationRendered`'s base fields only.
    expect(JSON.stringify(preview)).not.toContain(RELEASES);
    expect((preview as Record<string, unknown>).webhook).toBeUndefined();
    expect((preview as Record<string, unknown>).destination).toBeUndefined();

    await alepha.stop();
  });

  /**
   * A sensitive template withholds its variables from the admin. It must
   * also not smuggle them into a payload: the message goes to Discord
   * because that is what was asked for, and nothing else records it.
   */
  it("does not put a sensitive template's variables anywhere else", async ({
    expect,
  }) => {
    const { alepha, deliveries, sender, transport } = await started();

    await sender.send(
      {
        type: "discord",
        template: "dc-secret",
        variables: { code: "418294" },
        sensitive: true,
      },
      { executionId: "dc-exec-3" },
    );

    expect(transport.last()?.payload.content).toBe("code 418294");
    const [receipt] = await deliveries.list({});
    expect(receipt.subject ?? null).toBeNull();
    expect(receipt.body ?? null).toBeNull();

    await alepha.stop();
  });

  it("lets a refused post reach the notification job's retry", async ({
    expect,
  }) => {
    const { alepha, sender, transport, deliveries } = await started();
    transport.failWith = "429 Too Many Requests";

    await expect(
      sender.send(
        { type: "discord", template: "dc-shipped", variables: { tag: "v4" } },
        { executionId: "dc-exec-4" },
      ),
    ).rejects.toThrowError();

    const [receipt] = await deliveries.list({});
    expect(receipt.status).toBe("failed");
    expect(receipt.contact).toBe("discord:releases");

    await alepha.stop();
  });
});

describe("DiscordNotificationChannel boot checks", () => {
  it("refuses an empty destinations map", async ({ expect }) => {
    const { alepha } = await boot({ destinations: {}, templates: false });

    await expect(alepha.start()).rejects.toThrowError(
      /no destination is configured/,
    );
  });

  it("refuses a url that is not a Discord webhook", async ({ expect }) => {
    const { alepha } = await boot({
      destinations: { alerts: { webhook: "https://example.com/hook" } },
      templates: false,
    });

    await expect(alepha.start()).rejects.toThrowError(
      /"alerts" does not look like a Discord webhook url/,
    );
  });

  it("refuses a destination with no webhook at all", async ({ expect }) => {
    const { alepha } = await boot({
      destinations: { alerts: { webhook: "" } },
      templates: false,
    });

    await expect(alepha.start()).rejects.toThrowError(
      /"alerts" has no webhook url/,
    );
  });

  /**
   * Two defaults means the room a template with no `to` reaches depends on
   * object key order, which is exactly the kind of thing that works in
   * development and posts an incident into the release channel in production.
   */
  it("refuses two destinations flagged default", async ({ expect }) => {
    const { alepha } = await boot({
      destinations: {
        alerts: { webhook: ALERTS, default: true },
        releases: { webhook: RELEASES, default: true },
      },
      templates: false,
    });

    await expect(alepha.start()).rejects.toThrowError(/all declare/);
  });

  /**
   * The half the framework's own check cannot do: it verifies that something
   * provides `discord`, not that the room exists.
   */
  it("refuses a template naming a destination nobody configured", async ({
    expect,
  }) => {
    const { alepha } = await boot({
      destinations: { alerts: { webhook: ALERTS, default: true } },
    });

    await expect(alepha.start()).rejects.toThrowError(
      /posts to discord destination "releases", which is not configured/,
    );
  });

  it("refuses a template with no `to` when nothing is default", async ({
    expect,
  }) => {
    const { alepha } = await boot({
      destinations: {
        alerts: { webhook: ALERTS },
        releases: { webhook: RELEASES },
      },
    });

    await expect(alepha.start()).rejects.toThrowError(
      /names no discord destination and none is flagged/,
    );
  });
});
