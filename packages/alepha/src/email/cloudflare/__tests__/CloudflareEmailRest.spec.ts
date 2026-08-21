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
const ACCOUNT_ID = "acc-123";
const API_TOKEN = "tok-456";

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

/**
 * Captures the REST call instead of performing it. Overriding the single
 * seam the provider exposes keeps the test on real provider code — no
 * global fetch patching, no vi.mock.
 */
class TestCloudflareEmailProvider extends CloudflareEmailProvider {
  public requests: RecordedRequest[] = [];
  public status = 200;
  public payload: unknown = {
    success: true,
    result: { id: "rest-1", status: "queued" },
  };

  protected override async httpPost(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    this.requests.push({ url, init });
    return new Response(JSON.stringify(this.payload), {
      status: this.status,
      headers: { "content-type": "application/json" },
    });
  }
}

class FakeBinding implements CloudflareEmailBinding {
  public calls: CloudflareEmailSendMessage[] = [];

  public async send(
    message: CloudflareEmailSendMessage,
  ): Promise<CloudflareEmailSendResult> {
    this.calls.push(message);
    return { id: "binding-1", status: "queued" };
  }
}

const setup = async (options?: {
  binding?: CloudflareEmailBinding;
  rest?: boolean;
}) => {
  const alepha = Alepha.create({
    env: {
      EMAIL_FROM,
      ...(options?.rest === false
        ? {}
        : {
            CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
            CLOUDFLARE_API_TOKEN: API_TOKEN,
          }),
    },
  });
  if (options?.binding) {
    alepha.set("cloudflare.env", {
      [SEND_EMAIL_DEFAULT_BINDING]: options.binding,
    });
  }
  const provider = alepha.inject(TestCloudflareEmailProvider);
  await alepha.start();
  return { alepha, provider };
};

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Off Workers there is no `SEND_EMAIL` binding, so the provider used to be
 * permanently inert — `send()` threw "binding not initialized". With an
 * account id and an API token it can reach the same service over REST.
 */
describe("CloudflareEmailProvider — REST fallback", () => {
  it("sends over REST when no binding is available", async () => {
    const { provider } = await setup();

    await provider.send({
      to: "user@example.com",
      subject: "Welcome!",
      body: "<p>Hello</p>",
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/email/sending/send`,
    );
  });

  it("authorizes the REST call with the API token", async () => {
    const { provider } = await setup();

    await provider.send({
      to: "user@example.com",
      subject: "x",
      body: "<p>x</p>",
    });

    const headers = new Headers(provider.requests[0].init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_TOKEN}`);
    expect(provider.requests[0].init.method).toBe("POST");
  });

  it("sends the same payload the binding path builds", async () => {
    const { provider } = await setup();

    await provider.send({
      to: ["a@example.com", "b@example.com"],
      subject: "Broadcast",
      body: "<p>hi</p>",
    });

    expect(JSON.parse(String(provider.requests[0].init.body))).toEqual({
      to: ["a@example.com", "b@example.com"],
      from: EMAIL_FROM,
      subject: "Broadcast",
      html: "<p>hi</p>",
    });
  });

  it("prefers the binding when both are configured", async () => {
    const binding = new FakeBinding();
    const { provider } = await setup({ binding });

    await provider.send({
      to: "user@example.com",
      subject: "x",
      body: "<p>x</p>",
    });

    expect(binding.calls).toHaveLength(1);
    expect(provider.requests).toHaveLength(0);
  });

  it("wraps a REST failure as EmailError", async () => {
    const { provider } = await setup();
    provider.status = 403;
    provider.payload = {
      success: false,
      errors: [{ code: 10000, message: "Authentication error" }],
    };

    await expect(
      provider.send({
        to: "user@example.com",
        subject: "x",
        body: "<p>x</p>",
      }),
    ).rejects.toThrow(/Authentication error/);
  });

  it("reports a REST rate limit distinctly", async () => {
    const { provider } = await setup();
    provider.status = 429;
    provider.payload = { success: false, errors: [{ message: "slow down" }] };

    await expect(
      provider.send({
        to: "user@example.com",
        subject: "x",
        body: "<p>x</p>",
      }),
    ).rejects.toThrow(/rate limit/i);
  });

  it("explains both options when neither is configured", async () => {
    const { provider } = await setup({ rest: false });

    await expect(
      provider.send({
        to: "user@example.com",
        subject: "x",
        body: "<p>x</p>",
      }),
    ).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });
});
