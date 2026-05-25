import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import {
  type CloudflareEmailBinding,
  CloudflareEmailProvider,
  type CloudflareEmailSendMessage,
  type CloudflareEmailSendResult,
  SEND_EMAIL_DEFAULT_BINDING,
} from "../providers/CloudflareEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const EMAIL_FROM = "noreply@example.com";

class FakeBinding implements CloudflareEmailBinding {
  public calls: CloudflareEmailSendMessage[] = [];
  public response: CloudflareEmailSendResult = {
    id: "msg-1",
    status: "queued",
  };
  public error?: unknown;

  public async send(
    message: CloudflareEmailSendMessage,
  ): Promise<CloudflareEmailSendResult> {
    this.calls.push(message);
    if (this.error) {
      throw this.error;
    }
    return this.response;
  }
}

const setup = async (binding?: CloudflareEmailBinding | null) => {
  const alepha = Alepha.create({ env: { EMAIL_FROM } });
  if (binding !== null) {
    alepha.set("cloudflare.env", {
      [SEND_EMAIL_DEFAULT_BINDING]: binding ?? new FakeBinding(),
    });
  }
  const provider = alepha.inject(CloudflareEmailProvider);
  await alepha.start();
  return { alepha, provider };
};

// ---------------------------------------------------------------------------------------------------------------------

describe("CloudflareEmailProvider", () => {
  describe("send", () => {
    it("should send email through the binding with mapped fields", async () => {
      const binding = new FakeBinding();
      const { provider } = await setup(binding);

      await provider.send({
        to: "user@example.com",
        subject: "Welcome!",
        body: "<p>Hello</p>",
      });

      expect(binding.calls).toHaveLength(1);
      expect(binding.calls[0]).toEqual({
        to: ["user@example.com"],
        from: EMAIL_FROM,
        subject: "Welcome!",
        html: "<p>Hello</p>",
      });
    });

    it("should pass through multiple recipients", async () => {
      const binding = new FakeBinding();
      const { provider } = await setup(binding);

      await provider.send({
        to: ["a@example.com", "b@example.com"],
        subject: "Broadcast",
        body: "<p>hi</p>",
      });

      expect(binding.calls[0].to).toEqual(["a@example.com", "b@example.com"]);
    });

    it("should throw EmailError when the binding returns bounced", async () => {
      const binding = new FakeBinding();
      binding.response = { id: "msg-2", status: "bounced" };
      const { provider } = await setup(binding);

      await expect(
        provider.send({
          to: "user@example.com",
          subject: "x",
          body: "<p>x</p>",
        }),
      ).rejects.toThrow("Cloudflare email bounced (id=msg-2)");
    });

    it("should wrap binding errors as EmailError", async () => {
      const binding = new FakeBinding();
      binding.error = new Error("boom");
      const { provider } = await setup(binding);

      await expect(
        provider.send({
          to: "user@example.com",
          subject: "x",
          body: "<p>x</p>",
        }),
      ).rejects.toThrow("Failed to send email via Cloudflare: boom");
    });

    it("should surface 429 rate-limit errors with a dedicated message", async () => {
      const binding = new FakeBinding();
      const rateLimited = Object.assign(new Error("Too many requests"), {
        status: 429,
      });
      binding.error = rateLimited;
      const { provider } = await setup(binding);

      await expect(
        provider.send({
          to: "user@example.com",
          subject: "x",
          body: "<p>x</p>",
        }),
      ).rejects.toThrow("Cloudflare email rate limit hit (429)");
    });
  });

  describe("start", () => {
    it("should throw when no Cloudflare env is available", async () => {
      const alepha = Alepha.create({ env: { EMAIL_FROM } });
      alepha.inject(CloudflareEmailProvider);

      const err = await alepha.start().catch((e) => e);
      expect(String(err.cause ?? err)).toMatch(
        /Cloudflare Workers environment not found/,
      );
    });

    it("should throw when the SEND_EMAIL binding is missing", async () => {
      const alepha = Alepha.create({ env: { EMAIL_FROM } });
      alepha.set("cloudflare.env", {});
      alepha.inject(CloudflareEmailProvider);

      const err = await alepha.start().catch((e) => e);
      expect(String(err.cause ?? err)).toMatch(
        /Cloudflare Email binding 'SEND_EMAIL' not found/,
      );
    });
  });
});
