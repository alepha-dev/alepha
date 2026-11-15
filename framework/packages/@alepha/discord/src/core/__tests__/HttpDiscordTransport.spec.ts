import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, it } from "vitest";

import { HttpDiscordTransport } from "../transports/HttpDiscordTransport.ts";

const WEBHOOK = "https://discord.com/api/webhooks/1234567890/secret-token_x";

class RecordingTransport extends HttpDiscordTransport {
  public calls: Array<{ url: string; body: unknown }> = [];
  public answer: Response | Error = new Response(null, { status: 204 });
  protected override async request(url: string, init: RequestInit) {
    this.calls.push({ url, body: JSON.parse(String(init.body)) });
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

describe("HttpDiscordTransport", () => {
  const setup = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "trace" } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    const transport = alepha.inject(RecordingTransport);
    await alepha.start();
    return {
      alepha,
      transport,
      logs: alepha.inject(MemoryDestinationProvider),
    };
  };

  it("posts the payload, allowed mentions included, and logs no url", async ({
    expect,
  }) => {
    const { transport, logs } = await setup();
    await transport.post(WEBHOOK, {
      content: "@everyone deployed",
      allowed_mentions: { parse: [] },
    });
    expect(transport.calls).toEqual([
      {
        url: WEBHOOK,
        body: {
          content: "@everyone deployed",
          allowed_mentions: { parse: [] },
        },
      },
    ]);
    expect(JSON.stringify(logs.logs)).not.toContain("secret-token");
  });

  it("refuses with the status alone: no url, no cause", async ({ expect }) => {
    const { transport, logs } = await setup();
    transport.answer = new Response("nope", { status: 404 });
    const error = await transport
      .post(WEBHOOK, { content: "x" })
      .catch((caught: unknown) => caught as Error);
    expect(error.message).toContain("HTTP 404");
    expect(error.message).not.toContain("secret-token");
    expect(error.cause).toBeUndefined();
    transport.answer = new Error(`connect failed ${WEBHOOK}`);
    const network = await transport
      .post(WEBHOOK, { content: "x" })
      .catch((caught: unknown) => caught as Error);
    expect(network.message).not.toContain("secret-token");
    expect(network.cause).toBeUndefined();
    expect(JSON.stringify(logs.logs)).not.toContain("secret-token");
  });
});
