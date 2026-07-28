import { Alepha } from "alepha";
import { EmailError } from "alepha/email";
import type { Transporter } from "nodemailer";
import { describe, expect, it } from "vitest";
import {
  NodemailerEmailProvider,
  nodemailerEmailOptions,
} from "../providers/NodemailerEmailProvider.ts";

/**
 * `NodemailerEmailProvider` had no spec — nothing pinned how env vars map onto
 * the SMTP transport, that credentials are omitted rather than sent as
 * `undefined`, or that a send failure surfaces as `EmailError`.
 *
 * `createTransporter` is protected, so the real nodemailer transport is
 * swapped for a recording fake through a subclass — no `vi.mock`, per the
 * project's substitution rule.
 */
interface SentMail {
  from?: string;
  to?: string | string[];
  subject?: string;
  html?: string;
}

class FakeTransport {
  public readonly sent: SentMail[] = [];
  public closed = false;
  public verifyResult: boolean | Error = true;
  public sendError?: Error;

  async sendMail(mail: SentMail) {
    if (this.sendError) {
      throw this.sendError;
    }
    this.sent.push(mail);
    return { messageId: `msg-${this.sent.length}`, response: "250 OK" };
  }

  async verify() {
    if (this.verifyResult instanceof Error) {
      throw this.verifyResult;
    }
    return this.verifyResult;
  }

  close() {
    this.closed = true;
  }
}

class TestProvider extends NodemailerEmailProvider {
  public readonly transport = new FakeTransport();
  public configs: ReturnType<
    NodemailerEmailProvider["buildTransporterConfig"]
  >[] = [];
  public created = 0;

  protected override createTransporter(): Transporter {
    this.created++;
    // Record what the REAL mapping produces — not a copy of it — so a
    // regression in `buildTransporterConfig` fails these assertions.
    this.configs.push(this.buildTransporterConfig());
    return this.transport as unknown as Transporter;
  }

  public config() {
    return this.buildTransporterConfig();
  }
}

const baseEnv = {
  LOG_LEVEL: "error",
  EMAIL_HOST: "smtp.example.com",
  EMAIL_FROM: "noreply@example.com",
};

const setup = async (
  env: Record<string, string> = {},
  options: Record<string, unknown> = {},
) => {
  const alepha = Alepha.create({ env: { ...baseEnv, ...env } });
  const provider = alepha.inject(TestProvider);
  if (Object.keys(options).length > 0) {
    alepha.store.mut(nodemailerEmailOptions, () => options as never);
  }
  await alepha.start();
  return { alepha, provider };
};

describe("NodemailerEmailProvider", () => {
  describe("transport configuration", () => {
    it("maps the env vars onto the transport", async () => {
      const { provider } = await setup({
        EMAIL_PORT: "2525",
        EMAIL_SECURE: "true",
      });

      expect(provider.configs[0]).toMatchObject({
        host: "smtp.example.com",
        port: 2525,
        secure: true,
      });
    });

    it("defaults to port 587 and an insecure connection", async () => {
      const { provider } = await setup();

      expect(provider.configs[0]).toMatchObject({ port: 587, secure: false });
    });

    it("omits auth entirely when no credentials are set", async () => {
      const { provider } = await setup();

      // Sending `auth: { user: undefined }` makes nodemailer attempt an
      // anonymous LOGIN instead of skipping authentication.
      expect(provider.configs[0].auth).toBeUndefined();
    });

    it("omits auth when only one half of the credentials is set", async () => {
      const { provider } = await setup({ EMAIL_USER: "someone" });

      expect(provider.configs[0].auth).toBeUndefined();
    });

    it("passes credentials when both are set", async () => {
      const { provider } = await setup({
        EMAIL_USER: "someone",
        EMAIL_PASS: "secret",
      });

      expect(provider.configs[0].auth).toEqual({
        user: "someone",
        pass: "secret",
      });
    });

    it("threads the pooling options from the atom", async () => {
      const { provider } = await setup(
        {},
        {
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
          rateDelta: 1000,
          rateLimit: 10,
        },
      );

      expect(provider.configs[0]).toMatchObject({
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 10,
      });
    });

    it("creates the transport once and reuses it", async () => {
      const { provider } = await setup();

      await provider.send({ to: "a@example.com", subject: "1", body: "<p>1" });
      await provider.send({ to: "b@example.com", subject: "2", body: "<p>2" });

      // One on the start-hook verify, and none since.
      expect(provider.created).toBe(1);
    });
  });

  describe("send", () => {
    it("sends the message with the configured from address", async () => {
      const { provider } = await setup();

      await provider.send({
        to: "user@example.com",
        subject: "Welcome",
        body: "<h1>Hi</h1>",
      });

      expect(provider.transport.sent).toEqual([
        {
          from: "noreply@example.com",
          to: "user@example.com",
          subject: "Welcome",
          html: "<h1>Hi</h1>",
        },
      ]);
    });

    it("wraps a transport failure in EmailError", async () => {
      const { provider } = await setup();
      provider.transport.sendError = new Error("connection refused");

      await expect(
        provider.send({ to: "a@example.com", subject: "s", body: "b" }),
      ).rejects.toThrow(EmailError);
    });

    it("keeps the underlying reason in the message", async () => {
      const { provider } = await setup();
      provider.transport.sendError = new Error("connection refused");

      await expect(
        provider.send({ to: "a@example.com", subject: "s", body: "b" }),
      ).rejects.toThrow(/connection refused/);
    });

    it("refuses to send when EMAIL_FROM is missing", async () => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", EMAIL_HOST: "smtp.example.com" },
      });
      const provider = alepha.inject(TestProvider);
      await alepha.start();

      await expect(
        provider.send({ to: "a@example.com", subject: "s", body: "b" }),
      ).rejects.toThrow(/EMAIL_FROM/);
    });
  });

  describe("verify and close", () => {
    it("reports a healthy connection", async () => {
      const { provider } = await setup();

      expect(await provider.verify()).toBe(true);
    });

    it("reports an unreachable server as false rather than throwing", async () => {
      const { provider } = await setup();
      provider.transport.verifyResult = new Error("ECONNREFUSED");

      expect(await provider.verify()).toBe(false);
    });

    it("closes the transport on stop", async () => {
      const { alepha, provider } = await setup();

      await alepha.stop();

      expect(provider.transport.closed).toBe(true);
    });

    it("rebuilds the transport after close", async () => {
      const { provider } = await setup();

      provider.close();
      await provider.send({ to: "a@example.com", subject: "s", body: "b" });

      expect(provider.created).toBe(2);
    });
  });
});
