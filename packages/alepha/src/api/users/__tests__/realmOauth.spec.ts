import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import { $realm } from "../index.ts";

/**
 * Integration tests for the `oauth` realm feature flag: enabling
 * `features.oauth` on `$realm` must register the OAuth module and expose
 * the RFC 8414 authorization-server metadata endpoint.
 */
describe("alepha/api/oauth - $realm oauth feature", () => {
  it("exposes the authorization server metadata when features.oauth is enabled", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaSecurity)
      .with(() => ({ realm: $realm({ features: { oauth: true } }) }));
    await alepha.start();

    const { hostname } = alepha.inject(ServerProvider);
    const resp = await fetch(
      `${hostname}/.well-known/oauth-authorization-server`,
    );

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, string>;
    expect(body.token_endpoint.endsWith("/oauth/token")).toBe(true);
    expect(body.registration_endpoint.endsWith("/oauth/register")).toBe(true);
  });

  it("does not expose the metadata endpoint without features.oauth", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaSecurity)
      .with(() => ({ realm: $realm() }));
    await alepha.start();

    const { hostname } = alepha.inject(ServerProvider);
    const resp = await fetch(
      `${hostname}/.well-known/oauth-authorization-server`,
    );

    expect(resp.status).toBe(404);
  });
});
