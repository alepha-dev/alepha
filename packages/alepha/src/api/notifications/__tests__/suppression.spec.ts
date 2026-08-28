import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms, MemorySmsProvider } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationPreferenceProvider,
  NotificationSenderService,
  NotificationSuppressionService,
} from "../index.ts";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

class Templates {
  readonly reminder = $notification({
    name: "sup-reminder",
    category: "reminders",
    schema: z.object({}),
    email: { subject: "Reminder", body: "<p>Do the thing</p>" },
  });

  readonly newsletter = $notification({
    name: "sup-newsletter",
    category: "marketing",
    schema: z.object({}),
    email: { subject: "News", body: "<p>Read this</p>" },
  });

  readonly passwordReset = $notification({
    name: "sup-reset",
    category: "security",
    critical: true,
    schema: z.object({}),
    email: { subject: "Reset", body: "<p>Code</p>" },
  });

  readonly smsReminder = $notification({
    name: "sup-sms",
    category: "reminders",
    schema: z.object({}),
    sms: { message: "Do the thing" },
  });
}

const boot = async (
  configure?: (alepha: ReturnType<typeof Alepha.create>) => void,
) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiJobs);

  // Substitutions have to land before the module registers the service, or
  // the container has already injected the default and refuses.
  configure?.(alepha);
  alepha.with(AlephaApiNotifications);

  const templates = alepha.inject(Templates);
  await alepha.start();

  return {
    alepha,
    templates,
    suppressions: alepha.inject(NotificationSuppressionService),
    sender: alepha.inject(NotificationSenderService),
    mail: alepha.inject(MemoryEmailProvider),
    sms: alepha.inject(MemorySmsProvider),
  };
};

const emailPayload = (
  template: string,
  contact: string,
  extra: Record<string, unknown> = {},
) => ({
  type: "email" as const,
  template,
  contact,
  variables: {},
  ...extra,
});

describe("notification suppression gate", () => {
  describe("the two strengths", () => {
    it("lets an unsubscribed contact keep receiving critical mail", async ({
      expect,
    }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "unsubscribed",
        source: "link",
      });

      await sender.send(
        emailPayload("sup-reset", "a@example.com", {
          critical: true,
          category: "security",
        }),
      );

      expect(mail.records).toHaveLength(1);
    });

    it("blocks a non-critical send to an unsubscribed contact", async ({
      expect,
    }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "unsubscribed",
        source: "link",
      });

      await sender.send(
        emailPayload("sup-reminder", "a@example.com", {
          category: "reminders",
        }),
      );

      expect(mail.records).toHaveLength(0);
    });

    it("blocks even critical mail to an address that hard-bounced", async ({
      expect,
    }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "bounced",
        source: "cloudflare",
      });

      await sender.send(
        emailPayload("sup-reset", "a@example.com", {
          critical: true,
          category: "security",
        }),
      );

      expect(mail.records).toHaveLength(0);
    });

    it("blocks even critical mail to an address that complained", async ({
      expect,
    }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "complained",
        source: "brevo",
      });

      await sender.send(
        emailPayload("sup-reset", "a@example.com", {
          critical: true,
          category: "security",
        }),
      );

      expect(mail.records).toHaveLength(0);
    });
  });

  describe("categories", () => {
    it("blocks only the category that was unsubscribed", async ({ expect }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "unsubscribed",
        category: "marketing",
        source: "link",
      });

      await sender.send(
        emailPayload("sup-newsletter", "a@example.com", {
          category: "marketing",
        }),
      );
      expect(mail.records).toHaveLength(0);

      await sender.send(
        emailPayload("sup-reminder", "a@example.com", {
          category: "reminders",
        }),
      );
      expect(mail.records).toHaveLength(1);
    });

    it("blocks every category when none was named", async ({ expect }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "unsubscribed",
        source: "link",
      });

      await sender.send(
        emailPayload("sup-newsletter", "a@example.com", {
          category: "marketing",
        }),
      );
      await sender.send(
        emailPayload("sup-reminder", "a@example.com", {
          category: "reminders",
        }),
      );

      expect(mail.records).toHaveLength(0);
    });
  });

  describe("tenancy", () => {
    it("keeps one org's suppression out of another org's mail", async ({
      expect,
    }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        organizationId: ORG_A,
        contact: "a@example.com",
        channel: "email",
        reason: "unsubscribed",
        source: "link",
      });

      await sender.send(
        emailPayload("sup-reminder", "a@example.com", {
          organizationId: ORG_A,
          category: "reminders",
        }),
      );
      expect(mail.records).toHaveLength(0);

      await sender.send(
        emailPayload("sup-reminder", "a@example.com", {
          organizationId: ORG_B,
          category: "reminders",
        }),
      );
      expect(mail.records).toHaveLength(1);
    });
  });

  describe("the store", () => {
    it("leaves one row when the same suppression is written twice", async ({
      expect,
    }) => {
      const { suppressions } = await boot();
      const args = {
        contact: "a@example.com",
        channel: "email" as const,
        reason: "unsubscribed" as const,
        source: "link",
      };

      await suppressions.suppress(args);
      await suppressions.suppress(args);

      expect(await suppressions.list({})).toHaveLength(1);
    });

    it("leaves one row per org for the same contact", async ({ expect }) => {
      const { suppressions } = await boot();
      const args = {
        contact: "a@example.com",
        channel: "email" as const,
        reason: "unsubscribed" as const,
        source: "link",
      };

      await suppressions.suppress({ ...args, organizationId: ORG_A });
      await suppressions.suppress({ ...args, organizationId: ORG_A });
      await suppressions.suppress({ ...args, organizationId: ORG_B });

      expect(await suppressions.list({})).toHaveLength(2);
    });

    it("normalizes the contact so casing and spacing cannot dodge the gate", async ({
      expect,
    }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        contact: "  A@Example.COM ",
        channel: "email",
        reason: "bounced",
        source: "cloudflare",
      });

      await sender.send(emailPayload("sup-reminder", "a@example.com"));

      expect(mail.records).toHaveLength(0);
    });

    it("lets mail through again once the suppression is lifted", async ({
      expect,
    }) => {
      const { suppressions, sender, mail } = await boot();
      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "unsubscribed",
        source: "link",
      });

      const [row] = await suppressions.list({});
      await suppressions.lift(row.id);

      await sender.send(emailPayload("sup-reminder", "a@example.com"));

      expect(mail.records).toHaveLength(1);
    });
  });

  describe("channels", () => {
    it("gates sms as well as email", async ({ expect }) => {
      const { suppressions, sender, sms } = await boot();
      await suppressions.suppress({
        contact: "+33600000000",
        channel: "sms",
        reason: "unsubscribed",
        source: "link",
      });

      await sender.send({
        type: "sms",
        template: "sup-sms",
        contact: "+33600000000",
        variables: {},
        category: "reminders",
      });

      expect(sms.records).toHaveLength(0);
    });

    it("does not let an email suppression block an sms", async ({ expect }) => {
      const { suppressions, sender, sms } = await boot();
      await suppressions.suppress({
        contact: "+33600000000",
        channel: "email",
        reason: "unsubscribed",
        source: "link",
      });

      await sender.send({
        type: "sms",
        template: "sup-sms",
        contact: "+33600000000",
        variables: {},
        category: "reminders",
      });

      expect(sms.records).toHaveLength(1);
    });
  });

  describe("the preference seam", () => {
    it("allows everything by default", async ({ expect }) => {
      const { sender, mail } = await boot();

      await sender.send(emailPayload("sup-newsletter", "a@example.com"));

      expect(mail.records).toHaveLength(1);
    });

    it("skips a send the app's provider declines", async ({ expect }) => {
      class RefuseMarketing extends NotificationPreferenceProvider {
        public override async allows(options: {
          category?: string;
        }): Promise<boolean> {
          return options.category !== "marketing";
        }
      }

      const { sender, mail } = await boot((alepha) => {
        alepha.with({
          provide: NotificationPreferenceProvider,
          use: RefuseMarketing,
        });
      });

      await sender.send(
        emailPayload("sup-newsletter", "a@example.com", {
          category: "marketing",
        }),
      );
      expect(mail.records).toHaveLength(0);

      await sender.send(
        emailPayload("sup-reminder", "a@example.com", {
          category: "reminders",
        }),
      );
      expect(mail.records).toHaveLength(1);
    });

    it("never lets a preference override a bounce", async ({ expect }) => {
      class AllowEverything extends NotificationPreferenceProvider {
        public override async allows(): Promise<boolean> {
          return true;
        }
      }

      const { suppressions, sender, mail } = await boot((alepha) => {
        alepha.with({
          provide: NotificationPreferenceProvider,
          use: AllowEverything,
        });
      });

      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "bounced",
        source: "cloudflare",
      });

      await sender.send(emailPayload("sup-reminder", "a@example.com"));

      expect(mail.records).toHaveLength(0);
    });
  });

  describe("a skipped send is not a failure", () => {
    it("returns without throwing so the job completes", async ({ expect }) => {
      const { suppressions, sender } = await boot();
      await suppressions.suppress({
        contact: "a@example.com",
        channel: "email",
        reason: "bounced",
        source: "cloudflare",
      });

      const result = await sender.send(
        emailPayload("sup-reminder", "a@example.com"),
      );

      expect(result).toMatchObject({ skipped: "suppressed" });
    });

    it("reports the declining reason separately from a suppression", async ({
      expect,
    }) => {
      class RefuseAll extends NotificationPreferenceProvider {
        public override async allows(): Promise<boolean> {
          return false;
        }
      }

      const { sender } = await boot((alepha) => {
        alepha.with({
          provide: NotificationPreferenceProvider,
          use: RefuseAll,
        });
      });

      const result = await sender.send(
        emailPayload("sup-reminder", "a@example.com"),
      );

      expect(result).toMatchObject({ skipped: "declined" });
    });
  });
});
