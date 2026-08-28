import { Alepha, z } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationSenderService,
  NotificationSuppressionService,
  NotificationUnsubscribeService,
} from "../index.ts";

const PUBLIC_URL = "https://app.example.com";

class Templates {
  readonly reminder = $notification({
    name: "unsub-reminder",
    category: "reminders",
    schema: z.object({}),
    email: {
      subject: "Reminder",
      body: (vars) =>
        `<p>Do the thing</p><a href="${vars.unsubscribeUrl}">x</a>`,
    },
  });

  readonly reset = $notification({
    name: "unsub-reset",
    category: "security",
    critical: true,
    schema: z.object({}),
    email: { subject: "Reset", body: "<p>Code</p>" },
  });
}

const boot = async (env: Record<string, string> = {}) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      APP_SECRET: "a-test-secret-that-is-long-enough-to-use",
      PUBLIC_URL,
      ...env,
    },
  })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaServer)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const templates = alepha.inject(Templates);
  await alepha.start();

  return {
    alepha,
    templates,
    unsubscribe: alepha.inject(NotificationUnsubscribeService),
    suppressions: alepha.inject(NotificationSuppressionService),
    sender: alepha.inject(NotificationSenderService),
    hostname: alepha.inject(ServerProvider).hostname,
  };
};

const claims = {
  contact: "a@example.com",
  channel: "email" as const,
  category: "reminders",
  template: "unsub-reminder",
};

describe("unsubscribe token", () => {
  it("round-trips the claims it was minted with", async ({ expect }) => {
    const { unsubscribe, alepha } = await boot();

    const token = unsubscribe.mint(claims);
    expect(unsubscribe.verify(token)).toMatchObject(claims);

    await alepha.stop();
  });

  it("survives being put in a url", async ({ expect }) => {
    const { unsubscribe, alepha } = await boot();

    const token = unsubscribe.mint(claims);
    expect(encodeURIComponent(token)).toBe(token);

    await alepha.stop();
  });

  it("refuses a token whose claims were edited", async ({ expect }) => {
    const { unsubscribe, alepha } = await boot();

    const token = unsubscribe.mint(claims);
    const [payload, signature] = token.split(".");
    const forged = unsubscribe.mint({ ...claims, contact: "b@example.com" });
    const tampered = `${forged.split(".")[0]}.${signature}`;

    expect(unsubscribe.verify(tampered)).toBeUndefined();
    expect(unsubscribe.verify(`${payload}.deadbeef`)).toBeUndefined();
    expect(unsubscribe.verify("nonsense")).toBeUndefined();

    await alepha.stop();
  });
});

describe("unsubscribe route", () => {
  it("writes nothing on GET and does not echo the address", async ({
    expect,
  }) => {
    const { unsubscribe, suppressions, hostname, alepha } = await boot();
    const token = unsubscribe.mint(claims);

    const res = await fetch(`${hostname}/notifications/unsubscribe/${token}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).not.toContain("a@example.com");
    expect(await suppressions.list({})).toHaveLength(0);

    await alepha.stop();
  });

  it("writes exactly one suppression on POST, idempotently", async ({
    expect,
  }) => {
    const { unsubscribe, suppressions, hostname, alepha } = await boot();
    const token = unsubscribe.mint(claims);

    const first = await fetch(
      `${hostname}/notifications/unsubscribe/${token}`,
      { method: "POST" },
    );
    expect(first.status).toBe(200);

    await fetch(`${hostname}/notifications/unsubscribe/${token}`, {
      method: "POST",
    });

    const rows = await suppressions.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contact: "a@example.com",
      channel: "email",
      reason: "unsubscribed",
      category: "reminders",
      source: "link",
    });

    await alepha.stop();
  });

  it("accepts the RFC 8058 one-click form body", async ({ expect }) => {
    const { unsubscribe, suppressions, hostname, alepha } = await boot();
    const token = unsubscribe.mint(claims);

    const res = await fetch(`${hostname}/notifications/unsubscribe/${token}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });

    expect(res.status).toBe(200);
    expect(await suppressions.list({})).toHaveLength(1);

    await alepha.stop();
  });

  it("refuses a tampered token without writing", async ({ expect }) => {
    const { suppressions, hostname, alepha } = await boot();

    const res = await fetch(
      `${hostname}/notifications/unsubscribe/not-a-token`,
      {
        method: "POST",
      },
    );

    expect(res.status).toBe(400);
    expect(await suppressions.list({})).toHaveLength(0);

    await alepha.stop();
  });
});

describe("List-Unsubscribe headers", () => {
  it("is set on a non-critical template", async ({ expect }) => {
    const { sender, alepha } = await boot();

    const rendered = await sender.renderEmail({
      type: "email",
      template: "unsub-reminder",
      contact: "a@example.com",
      variables: {},
      category: "reminders",
    });

    expect(rendered.headers?.["List-Unsubscribe"]).toMatch(
      /^<https:\/\/app\.example\.com\/notifications\/unsubscribe\/.+>$/,
    );
    expect(rendered.headers?.["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );

    await alepha.stop();
  });

  it("is absent on a critical template", async ({ expect }) => {
    const { sender, alepha } = await boot();

    const rendered = await sender.renderEmail({
      type: "email",
      template: "unsub-reset",
      contact: "a@example.com",
      variables: {},
      category: "security",
      critical: true,
    });

    expect(rendered.headers?.["List-Unsubscribe"]).toBeUndefined();

    await alepha.stop();
  });

  it("is absent when PUBLIC_URL is not set, rather than relative", async ({
    expect,
  }) => {
    const { sender, alepha } = await boot({ PUBLIC_URL: "" });

    const rendered = await sender.renderEmail({
      type: "email",
      template: "unsub-reminder",
      contact: "a@example.com",
      variables: {},
      category: "reminders",
    });

    expect(rendered.headers?.["List-Unsubscribe"]).toBeUndefined();

    await alepha.stop();
  });

  it("hands the same url to the body as unsubscribeUrl", async ({ expect }) => {
    const { sender, alepha } = await boot();

    const rendered = await sender.renderEmail({
      type: "email",
      template: "unsub-reminder",
      contact: "a@example.com",
      variables: {},
      category: "reminders",
    });

    const header = rendered.headers?.["List-Unsubscribe"] ?? "";
    const url = header.slice(1, -1);
    expect(url).toBeTruthy();
    expect(rendered.body).toContain(`href="${url}"`);

    await alepha.stop();
  });

  it("leaves unsubscribeUrl undefined on a critical template", async ({
    expect,
  }) => {
    const { sender, alepha } = await boot();

    const rendered = await sender.renderEmail({
      type: "email",
      template: "unsub-reminder",
      contact: "a@example.com",
      variables: {},
      category: "reminders",
      critical: true,
    });

    expect(rendered.body).toContain("undefined");

    await alepha.stop();
  });
});
