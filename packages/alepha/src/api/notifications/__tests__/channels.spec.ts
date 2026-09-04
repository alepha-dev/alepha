import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationChannel,
  NotificationChannelService,
  type NotificationRendered,
  type NotificationRenderInput,
} from "../index.ts";

/**
 * A plugin adds its channel key by declaration merging, from a single entry
 * point. Doing it here rather than casting is deliberate: it is the same
 * mechanism `@alepha/discord` uses, so if it ever stopped working these
 * specs would stop compiling.
 */
declare module "alepha/api/notifications" {
  interface NotificationChannels<V> {
    /**
     * A channel these specs register.
     */
    fax?: { message: (variables: V) => string | Promise<string> };
    /**
     * A channel these specs never register, to prove the boot check.
     */
    pager?: { message: (variables: V) => string | Promise<string> };
  }
}

type FaxMessage = { message: (variables: any) => string | Promise<string> };

class FaxChannel extends NotificationChannel<FaxMessage> {
  public readonly channel = "fax";
  public readonly addressable = true;

  public readonly sent: NotificationRendered[] = [];

  public async render(input: NotificationRenderInput<FaxMessage>) {
    return {
      recipient: this.requireContact(input.payload),
      body: await input.message.message(input.variables),
    };
  }

  public async send(rendered: NotificationRendered) {
    this.sent.push(rendered);
    return { messageId: "fax-1" };
  }
}

class Templates {
  readonly mixed = $notification({
    name: "mixed",
    schema: z.object({ tag: z.text() }),
    email: { subject: "Shipped", body: (v) => `<p>${v.tag}</p>` },
    fax: { message: (v) => `shipped ${v.tag}` },
  });
}

class UnservedTemplates {
  readonly beeped = $notification({
    name: "beeped",
    schema: z.object({ tag: z.text() }),
    pager: { message: (v) => `shipped ${v.tag}` },
  });
}

const container = () =>
  Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

describe("notification channels", () => {
  it("discovers every registered channel, the built-ins included", async ({
    expect,
  }) => {
    const alepha = container();
    alepha.inject(FaxChannel);
    const channels = alepha.inject(NotificationChannelService);
    await alepha.start();

    expect(
      channels
        .all()
        .map((it) => it.channel)
        .sort(),
    ).toEqual(["email", "fax", "sms"]);
    expect(channels.find("fax")).toBeInstanceOf(FaxChannel);
    expect(channels.find("telex")).toBeUndefined();

    await alepha.stop();
  });

  /**
   * The intersection, not the declaration: a template declaring `email` and
   * `fax` reports both only because both are registered, and `sms` never
   * appears just because the module ships an sms channel.
   */
  it("reports the intersection of declared blocks and registered channels", async ({
    expect,
  }) => {
    const alepha = container();
    alepha.inject(FaxChannel);
    const templates = alepha.inject(Templates);
    await alepha.start();

    expect(templates.mixed.channels().sort()).toEqual(["email", "fax"]);

    await alepha.stop();
  });

  /**
   * Without this, a missing plugin does not fail: the intersection quietly
   * drops the channel and the message is never sent. The refusal has to name
   * the template, the channel and the module to import, or it is a puzzle
   * rather than a fix.
   */
  it("refuses to boot when a template declares a channel nothing provides", async ({
    expect,
  }) => {
    const alepha = container();
    alepha.inject(UnservedTemplates);

    await expect(alepha.start()).rejects.toThrowError(
      /template "beeped" declares channel "pager".*alepha\.with\(AlephaPagerNotifications\)/s,
    );
  });

  /**
   * A reserved option key is not a channel. Without the compiler-owned
   * reserved list, adding an option to `NotificationPrimitiveOptions` would
   * read as a channel nothing provides and refuse every boot.
   */
  it("does not mistake a reserved option for a channel", async ({ expect }) => {
    class Reserved {
      readonly documented = $notification({
        name: "documented",
        description: "has every reserved key set",
        category: "ops",
        critical: true,
        sensitive: true,
        schema: z.object({ tag: z.text() }),
        email: { subject: "Shipped", body: (v) => `<p>${v.tag}</p>` },
        translations: {
          fr: { email: { subject: "Livre", body: (v) => `<p>${v.tag}</p>` } },
        },
      });
    }

    const alepha = container();
    alepha.inject(Reserved);
    await expect(alepha.start()).resolves.toBeDefined();

    await alepha.stop();
  });

  /**
   * A receipt has to name the transport, not the adapter over it, or an
   * operator chasing a message that never arrived is told the framework's
   * own class name.
   */
  it("reports the transport class as the provider name", async ({ expect }) => {
    const alepha = container();
    const fax = alepha.inject(FaxChannel);
    const channels = alepha.inject(NotificationChannelService);
    await alepha.start();

    expect(channels.require("email").providerName()).toBe(
      "MemoryEmailProvider",
    );
    expect(channels.require("sms").providerName()).toBe("MemorySmsProvider");
    // The default: a channel that IS its own transport reports itself.
    expect(fax.providerName()).toBe("FaxChannel");

    await alepha.stop();
  });
});
