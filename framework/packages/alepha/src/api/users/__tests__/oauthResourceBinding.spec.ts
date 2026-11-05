import { createHash, randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { OAuthClientService, oauthOptions } from "alepha/api/oauth";
import { AlephaEmail } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { sessions } from "../entities/sessions.ts";
import { $realm, AlephaApiUsers, RealmProvider } from "../index.ts";

/**
 * RFC 8707 binding through the real session store: the resource an OAuth
 * grant is bound to is written to `sessions.resource` and signed back into
 * the token's `aud` on every refresh, by both refresh routes.
 */
class TestApp {
  realm = $realm({ features: { oauth: true } });
  sessions = $repository(sessions);
}

const decode = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());

describe("sessions.resource", () => {
  it("keeps a grant's resource across refresh at /oauth/token and /_auth/refresh", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with(AlephaServer)
      .with(AlephaOrmPostgres)
      .with(AlephaSecurity)
      .with(AlephaEmail)
      .with(AlephaApiUsers);
    alepha.set(oauthOptions, { ...oauthOptions.options.default });
    const app = alepha.inject(TestApp);
    await alepha.start();

    const { hostname } = alepha.inject(ServerProvider);
    const oauth = alepha.inject(OAuthClientService);
    const username = `bound-${randomUUID().slice(0, 8)}`;
    const user = await alepha
      .inject(RealmProvider)
      .userRepository()
      .create({ username, email: `${username}@example.com`, roles: ["user"] });
    const redirectUri = "https://bound.example.com/callback";
    const client = await oauth.register({
      realm: "users",
      clientName: `Bound App ${randomUUID()}`,
      redirectUris: [redirectUri],
      scopes: ["mcp"],
    });

    const post = async (path: string, body: Record<string, string>) => {
      const response = await fetch(`${hostname}${path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as Record<string, string>;
    };

    const verifier = `verifier-${randomUUID()}`;
    const code = await oauth.createAuthorizationCode("users", {
      userId: user.id,
      clientId: client.clientId,
      redirectUri,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      scopes: ["mcp"],
    });
    const granted = await post("/oauth/token", {
      grant_type: "authorization_code",
      code,
      client_id: client.clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const declared = `${hostname}/mcp`;
    expect(decode(granted.access_token!).aud).toEqual(["users", declared]);

    const row = await app.sessions.findOne({
      where: { refreshToken: { eq: granted.refresh_token! } },
    });
    expect(row?.resource).toBe(declared);

    const viaOAuth = await post("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: granted.refresh_token!,
      client_id: client.clientId,
    });
    expect(decode(viaOAuth.access_token!).aud).toEqual(["users", declared]);

    const viaAuth = await fetch(
      `${hostname}/_auth/refresh?provider=credentials&realm=users`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: granted.refresh_token }),
      },
    );
    expect(viaAuth.status).toBe(200);
    const refreshed = (await viaAuth.json()) as Record<string, string>;
    expect(decode(refreshed.access_token!).aud).toEqual(["users", declared]);
    await alepha.stop();
  });
});
