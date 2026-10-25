import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BrevoEmailProvider } from "../providers/BrevoEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const BREVO_API_KEY = "xkeysib-test-key";
const EMAIL_FROM = "noreply@example.com";

describe("BrevoEmailProvider", () => {
  let provider: BrevoEmailProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: "test-123" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const alepha = Alepha.create({
      env: {
        BREVO_API_KEY,
        EMAIL_FROM,
      },
    });
    provider = alepha.inject(BrevoEmailProvider);
    await alepha.start();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("should send email with correct Brevo API payload", async () => {
    await provider.send({
      to: "user@example.com",
      subject: "Welcome!",
      body: "<p>Hello World!</p>",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({
        method: "POST",
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: EMAIL_FROM },
          to: [{ email: "user@example.com" }],
          subject: "Welcome!",
          htmlContent: "<p>Hello World!</p>",
        }),
      }),
    );
  });

  test("should handle multiple recipients", async () => {
    await provider.send({
      to: ["user1@example.com", "user2@example.com"],
      subject: "Broadcast",
      body: "<p>Hello all</p>",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.to).toEqual([
      { email: "user1@example.com" },
      { email: "user2@example.com" },
    ]);
  });

  test("should throw EmailError on non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(
      provider.send({
        to: "user@example.com",
        subject: "Test",
        body: "Test",
      }),
    ).rejects.toThrow("Brevo API returned 401: Unauthorized");
  });

  test("should throw EmailError on fetch failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    await expect(
      provider.send({
        to: "user@example.com",
        subject: "Test",
        body: "Test",
      }),
    ).rejects.toThrow("Failed to send email via Brevo: Network error");
  });
});
