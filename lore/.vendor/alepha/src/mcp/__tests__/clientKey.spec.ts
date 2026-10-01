import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaMcp, StreamableHttpMcpTransport } from "../index.ts";

/**
 * Exposes the protected key builder, so the rule can be read without an HTTP
 * round trip.
 */
class KeyProbe extends StreamableHttpMcpTransport {
  public key = (request: { headers: Record<string, any>; user?: unknown }) =>
    this.buildClientKey(request);
}

/**
 * #Q2513: nothing mints an `Mcp-Session-Id`, so a key built from that
 * header alone was `undefined` for every client, and every client shared
 * one cancellation namespace. The authenticated user keys it now.
 */
describe("StreamableHttpMcpTransport.buildClientKey", () => {
  const probe = async () => {
    const alepha = Alepha.create()
      .with(AlephaMcp)
      .with({ provide: StreamableHttpMcpTransport, use: KeyProbe });
    await alepha.start();
    return alepha.inject(StreamableHttpMcpTransport) as KeyProbe;
  };

  it("keys on the authenticated user, so two users never share a key", async () => {
    const transport = await probe();

    expect(transport.key({ headers: {}, user: { id: "u-1" } })).toBe(
      "user:u-1",
    );
    expect(transport.key({ headers: {}, user: { id: "u-2" } })).not.toBe(
      transport.key({ headers: {}, user: { id: "u-1" } }),
    );
  });

  it("narrows the user's key with a session id, and never lets a session id alone pass for a user", async () => {
    const transport = await probe();

    expect(
      transport.key({
        headers: { "mcp-session-id": "s-9" },
        user: { id: "u-1" },
      }),
    ).toBe("user:u-1:s-9");
    expect(transport.key({ headers: { "mcp-session-id": "u-1" } })).toBe(
      "session:u-1",
    );
  });

  it("has no key for a caller with neither", async () => {
    const transport = await probe();

    expect(transport.key({ headers: {} })).toBeUndefined();
  });
});
