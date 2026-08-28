import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { $email } from "../primitives/$email.ts";
import { MemoryEmailProvider } from "../providers/MemoryEmailProvider.ts";

/**
 * A caller-controlled header map is a spoofing surface: whoever can set
 * `From` can send mail as anyone the app is allowed to send as. The envelope
 * headers are therefore refused rather than stripped, so the bug or the
 * attack surfaces instead of silently doing something other than what the
 * caller asked for.
 */
class Mailer {
  readonly channel = $email({ name: "test", provider: "memory" });
}

const boot = async () => {
  const alepha = Alepha.create();
  const mailer = alepha.inject(Mailer);
  await alepha.start();
  return { alepha, mailer };
};

const base = {
  to: "someone@example.com",
  subject: "Hello",
  body: "<p>Hi</p>",
};

describe("$email refuses reserved headers", () => {
  it("passes a non-reserved header through to the provider", async ({
    expect,
  }) => {
    const { alepha, mailer } = await boot();

    await mailer.channel.send({
      ...base,
      headers: { "List-Unsubscribe": "<https://example.com/u/abc>" },
    });

    const mail = alepha.inject(MemoryEmailProvider);
    expect(mail.last?.headers).toEqual({
      "List-Unsubscribe": "<https://example.com/u/abc>",
    });
  });

  it("refuses From", async ({ expect }) => {
    const { mailer } = await boot();

    await expect(
      mailer.channel.send({ ...base, headers: { From: "evil@example.org" } }),
    ).rejects.toThrowError(/From/);
  });

  it("refuses a reserved header whatever its casing", async ({ expect }) => {
    const { mailer } = await boot();

    await expect(
      mailer.channel.send({ ...base, headers: { bCc: "evil@example.org" } }),
    ).rejects.toThrowError(/bCc/);
  });

  it("refuses Reply-To, which has its own option", async ({ expect }) => {
    const { mailer } = await boot();

    await expect(
      mailer.channel.send({
        ...base,
        headers: { "Reply-To": "evil@example.org" },
      }),
    ).rejects.toThrowError(/Reply-To/);
  });

  it("sends nothing when a header is refused", async ({ expect }) => {
    const { alepha, mailer } = await boot();

    await expect(
      mailer.channel.send({ ...base, headers: { Subject: "spoofed" } }),
    ).rejects.toThrow();

    const mail = alepha.inject(MemoryEmailProvider);
    expect(mail.records).toHaveLength(0);
  });

  it("returns the provider's messageId to the caller", async ({ expect }) => {
    const { alepha, mailer } = await boot();

    const result = await mailer.channel.send(base);

    const mail = alepha.inject(MemoryEmailProvider);
    expect(result.messageId).toBe(mail.last?.messageId);
  });
});
