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

  /**
   * The reserved-name list stops a caller who asks for `Bcc` politely. It
   * does not stop one who smuggles a whole header through a line break,
   * which is the threat this policy's own doc describes — and both of the
   * shapes below passed the guard completely.
   *
   * There is no known live exploit: nodemailer strips newlines from values,
   * and the JSON-bodied providers have no raw MIME to inject into. That is
   * what these cover — the protection was coming from the transports rather
   * than from the framework that advertises it, so the next provider added
   * inherits nothing.
   */
  it("refuses a value carrying CRLF", async ({ expect }) => {
    const { mailer } = await boot();

    await expect(
      mailer.channel.send({
        ...base,
        headers: { "X-Custom": "a\r\nBcc: attacker@example.com" },
      }),
    ).rejects.toThrowError(/line break/);
  });

  it("refuses a value carrying a bare LF", async ({ expect }) => {
    // A bare newline folds just as well as a CRLF pair, and a check written
    // against `\r\n` alone would miss it.
    const { mailer } = await boot();

    await expect(
      mailer.channel.send({
        ...base,
        headers: { "X-Custom": "a\nBcc: attacker@example.com" },
      }),
    ).rejects.toThrowError(/line break/);
  });

  it("refuses a name carrying a colon", async ({ expect }) => {
    const { mailer } = await boot();

    await expect(
      mailer.channel.send({
        ...base,
        headers: { "X-A: x": "y" },
      }),
    ).rejects.toThrowError(/not a valid header name/);
  });

  it("refuses a name carrying CRLF", async ({ expect }) => {
    // Lowercased this is "x-a: x\r\nbcc", which is not in the reserved set —
    // so the name check is what catches it, not the reserved one.
    const { mailer } = await boot();

    await expect(
      mailer.channel.send({
        ...base,
        headers: { "X-A: x\r\nBcc": "y" },
      }),
    ).rejects.toThrowError(/not a valid header name/);
  });

  it("still accepts an ordinary List-Unsubscribe", async ({ expect }) => {
    // The guard has to stay usable: this is the header the option exists for,
    // and its angle brackets and commas are all valid in a value.
    const { alepha, mailer } = await boot();

    await mailer.channel.send({
      ...base,
      headers: {
        "List-Unsubscribe":
          "<https://example.com/u/abc>, <mailto:u@example.com>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    expect(alepha.inject(MemoryEmailProvider).last?.headers).toEqual({
      "List-Unsubscribe": "<https://example.com/u/abc>, <mailto:u@example.com>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
