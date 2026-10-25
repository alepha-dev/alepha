import { describe, expect, it } from "vitest";

import type { EmailProvider } from "../providers/EmailProvider.ts";

/**
 * What a provider actually handed to its transport, normalized across the
 * five of them so one suite can assert all five.
 *
 * The adapter in each provider's own spec is responsible for reading its
 * transport (an SMTP options object, a `fetch` body, a Workers binding call,
 * a file on disk, an in-memory record) and filling this in.
 */
export interface SentEmail {
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface EmailConformanceHarness {
  provider: EmailProvider;
  /**
   * The last message the provider put on the wire, or undefined if it sent
   * nothing.
   */
  lastSent(): Promise<SentEmail | undefined> | (SentEmail | undefined);
}

/**
 * Behaviour every {@link EmailProvider} must exhibit for the fields added in
 * quest #1263 (`text`, `replyTo`, `headers`, and the returned `messageId`).
 *
 * The fixtures are chosen to actually exercise the mapping rather than to
 * look plausible, which is the lesson `analyticsConformance.ts` paid for:
 *
 * - `text` differs from the html body, so a provider that maps the body into
 *   both slots fails instead of passing by coincidence.
 * - `replyTo` differs from `EMAIL_FROM`, so a provider that echoes the sender
 *   fails.
 * - the header name is mixed-case with a hyphen, so a provider that
 *   lower-cases or strips the map fails. A single lowercase word would be
 *   identical either way and would pass with no mapping at all.
 */
export const emailProviderConformance = (
  name: string,
  factory: () => Promise<EmailConformanceHarness>,
) => {
  const base = {
    to: "recipient@example.com",
    subject: "Conformance",
    body: "<p>Hello</p>",
  };

  describe(`EmailProvider conformance: ${name}`, () => {
    it("carries a text part distinct from the html body", async () => {
      const harness = await factory();
      await harness.provider.send({
        ...base,
        text: "Hello in plain text",
      });

      const sent = await harness.lastSent();
      expect(sent?.html).toBe("<p>Hello</p>");
      expect(sent?.text).toBe("Hello in plain text");
    });

    it("carries a replyTo that differs from the sender", async () => {
      const harness = await factory();
      await harness.provider.send({
        ...base,
        replyTo: "support@example.org",
      });

      const sent = await harness.lastSent();
      expect(sent?.replyTo).toBe("support@example.org");
    });

    it("carries custom headers with their name casing preserved", async () => {
      const harness = await factory();
      await harness.provider.send({
        ...base,
        headers: { "List-Unsubscribe": "<https://example.com/u/abc>" },
      });

      const sent = await harness.lastSent();
      expect(sent?.headers).toMatchObject({
        "List-Unsubscribe": "<https://example.com/u/abc>",
      });
    });

    it("omits text, replyTo and headers when the caller gave none", async () => {
      const harness = await factory();
      await harness.provider.send(base);

      const sent = await harness.lastSent();
      expect(sent?.text).toBeUndefined();
      expect(sent?.replyTo).toBeUndefined();
      expect(sent?.headers).toBeUndefined();
    });

    it("returns a messageId from send()", async () => {
      const harness = await factory();
      const result = await harness.provider.send(base);

      expect(result).toBeDefined();
      expect(typeof result.messageId).toBe("string");
      expect(result.messageId).not.toBe("");
    });
  });
};
