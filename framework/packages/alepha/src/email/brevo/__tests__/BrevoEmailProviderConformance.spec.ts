import { Alepha } from "alepha";
import { afterEach, vi } from "vitest";

import { emailProviderConformance } from "../../core/__tests__/emailProviderConformance.ts";
import { BrevoEmailProvider } from "../providers/BrevoEmailProvider.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

emailProviderConformance("BrevoEmailProvider", async () => {
  const requests: Array<Record<string, any>> = [];

  const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ messageId: "brevo-msg-1" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);

  const alepha = Alepha.create({
    env: {
      BREVO_API_KEY: "xkeysib-test-key",
      EMAIL_FROM: "noreply@example.com",
    },
  });
  const provider = alepha.inject(BrevoEmailProvider);
  await alepha.start();

  return {
    provider,
    lastSent: () => {
      const body = requests[requests.length - 1];
      if (!body) return undefined;
      return {
        to: (body.to as Array<{ email: string }>).map((it) => it.email),
        subject: body.subject,
        html: body.htmlContent,
        text: body.textContent,
        replyTo: body.replyTo?.email,
        headers: body.headers,
      };
    },
  };
});
