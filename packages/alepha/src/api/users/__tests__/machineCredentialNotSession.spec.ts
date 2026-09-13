import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { ApiKeyService } from "alepha/api/keys";
import { OAuthClientService } from "alepha/api/oauth";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $secure, AlephaSecurity, SecurityProvider } from "alepha/security";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $realm, AlephaApiUsers, RealmProvider } from "../index.ts";

/**
 * D10: a machine credential is not a session.
 *
 * An API key may read and call the permission-checked actions its roles
 * allow, but a route that mints or revokes credentials, approves an OAuth
 * grant, or changes the account refuses it. Before this, nothing downstream
 * of `ApiKeyService.validate()` could tell a key from a session, and a leaked
 * CI key could set a first password on a GitHub-only account.
 */
class TestApp {
  realm = $realm({
    features: { apiKeys: true, avatars: true, oauth: true },
  });

  whoami = $action({
    path: "/whoami-credential",
    use: [$secure()],
    schema: {
      response: z.object({
        id: z.text(),
        credential: z.text().optional(),
      }),
    },
    handler: ({ user }) => ({
      id: user.id,
      credential: user.credential?.type,
    }),
  });
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaEmail)
    .with(AlephaApiUsers);
  const app = alepha.inject(TestApp);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  const keys = alepha.inject(ApiKeyService);
  const { hostname } = alepha.inject(ServerProvider);

  const username = `d10-${randomUUID().slice(0, 8)}`;
  const user = await realmProvider.userRepository().create({
    username,
    email: `${username}@example.com`,
    roles: ["user"],
  });

  const { token: apiKey, apiKey: keyRow } = await keys.create({
    userId: user.id,
    name: "CI",
    roles: ["user"],
  });
  const session = await app.realm.createToken({
    id: user.id,
    roles: ["user"],
  });

  const call = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${hostname}${path}`, {
      method,
      redirect: "manual",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && !(body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
      },
      body:
        body instanceof FormData
          ? body
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
    });

  return {
    alepha,
    app,
    hostname,
    oauth: alepha.inject(OAuthClientService),
    keys,
    user,
    apiKey,
    keyRow,
    sessionToken: session.access_token,
    call,
  };
};

/**
 * Every route D10 closes to a machine credential in the framework. The rule
 * is the path for `/users/me`, so a new account route belongs here the day it
 * is added.
 */
const SESSION_ONLY_ROUTES: Array<[string, string, unknown?]> = [
  ["POST", "/api/api-keys", { name: "minted by a key" }],
  ["DELETE", `/api/api-keys/${randomUUID()}`],
  ["POST", `/api/api-keys/${randomUUID()}/rotate`, {}],
  [
    "POST",
    "/api/users/me/password",
    { currentPassword: "x", newPassword: "y" },
  ],
  ["POST", "/api/users/me/identities/password", { password: "x" }],
  ["DELETE", `/api/users/me/identities/${randomUUID()}`],
  ["POST", "/api/users/me/mfa/totp/enroll", {}],
  ["POST", "/api/users/me/mfa/totp/activate", { code: "000000" }],
  ["DELETE", "/api/users/me/mfa/totp", { code: "000000" }],
  ["POST", "/api/users/me/mfa/totp/recovery-codes", { code: "000000" }],
  ["DELETE", `/api/users/me/sessions/${randomUUID()}`],
  ["POST", "/api/users/me/sessions/revoke-others", {}],
  ["DELETE", `/api/users/me/connections/${randomUUID()}`],
  ["PATCH", "/api/users/me", { firstName: "Mallory" }],
  // A body the schema accepts, or validation answers before the gate does.
  // The confirmation is wrong on purpose, so the session call deletes nothing.
  ["DELETE", "/api/users/me", { confirm: "not-the-email" }],
  ["POST", "/api/users/me/avatar", "avatar"],
  ["DELETE", "/api/users/me/avatar"],
];

const SESSION_REQUIRED = "requires a signed-in session";

describe("a machine credential is not a session", () => {
  it("marks a key-authenticated identity, and the marker survives action.run()", async () => {
    const { alepha, app, keys, apiKey, keyRow, user, call } = await setup();

    const info = await keys.validate(apiKey);
    expect(info?.credential).toEqual({ type: "api-key", id: keyRow.id });

    // Over HTTP, through the resolver.
    const response = await call("GET", "/api/whoami-credential", apiKey);
    expect(await response.json()).toEqual({
      id: user.id,
      credential: "api-key",
    });

    // Over action.run(): the identity is published through the schema decode
    // into currentUserAtom, which strips any field it does not declare.
    const identity = alepha
      .inject(SecurityProvider)
      .createUser(info!, { realm: "users" });
    const ran = await app.whoami.run({}, { user: identity });
    expect(ran.credential).toBe("api-key");
  });

  it.each(SESSION_ONLY_ROUTES)(
    "refuses %s %s to an API key, and lets a session through the gate",
    async (method, path, body) => {
      const { apiKey, sessionToken, call } = await setup();

      // A multipart body cannot be built once and reused: each call gets its own.
      const payload = () => {
        if (body !== "avatar") return body;
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
          "avatar.png",
        );
        return form;
      };

      const refused = await call(method, path, apiKey, payload());
      expect(refused.status).toBe(403);
      expect(await refused.text()).toContain(SESSION_REQUIRED);

      // The same route from a session may still fail for its own reasons (no
      // such session id, a wrong code), but never on the credential gate.
      const allowed = await call(method, path, sessionToken, payload());
      expect(await allowed.text()).not.toContain(SESSION_REQUIRED);
    },
  );

  it("still answers GET /users/me and /api/_links to a key (D8)", async () => {
    const { apiKey, user, call } = await setup();

    const me = await call("GET", "/api/users/me", apiKey);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { id: string }).id).toBe(user.id);

    const links = await call("GET", "/api/_links", apiKey);
    expect(links.status).toBe(200);

    const keys = await call("GET", "/api/api-keys", apiKey);
    expect(keys.status).toBe(200);
  });

  describe("the OAuth approval routes treat a key as no user", () => {
    const authorizeQuery = (clientId: string, redirectUri: string) =>
      new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: "x",
        code_challenge_method: "S256",
      });

    it("sends a key to login on GET /oauth/authorize, even for a trusted client that mints with no POST", async () => {
      const { apiKey, sessionToken, oauth, call } = await setup();
      const redirectUri = "https://app.example.com/auth/callback";
      const client = await oauth.register({
        realm: "users",
        clientName: "First Party",
        redirectUris: [redirectUri],
        scopes: ["openid"],
        trusted: true,
      });
      const query = authorizeQuery(client.clientId, redirectUri);

      const asKey = await call("GET", `/oauth/authorize?${query}`, apiKey);
      expect(asKey.status).toBe(302);
      const toLogin = new URL(asKey.headers.get("location") ?? "", "http://x");
      expect(toLogin.searchParams.get("code")).toBeNull();
      expect(toLogin.pathname).not.toBe("/auth/callback");

      // A session is handed the code directly: the path the key must not take.
      const asSession = await call(
        "GET",
        `/oauth/authorize?${query}`,
        sessionToken,
      );
      expect(asSession.status).toBe(302);
      const withCode = new URL(asSession.headers.get("location") ?? "");
      expect(withCode.searchParams.get("code")).toBeTruthy();
    });

    it("refuses POST /oauth/authorize to a key as unauthenticated", async () => {
      const { apiKey, call } = await setup();

      const decision = await call("POST", "/oauth/authorize", apiKey, {
        decision: "allow",
        response_type: "code",
        client_id: "c",
        redirect_uri: "https://app.example.com/auth/callback",
        code_challenge: "x",
        code_challenge_method: "S256",
      });
      expect(decision.status).toBe(401);
    });

    it("sends a key to login on GET /oauth/device and refuses its POST", async () => {
      const { apiKey, sessionToken, hostname, call } = await setup();

      const devicePage = await call("GET", "/oauth/device", apiKey);
      expect(devicePage.status).toBe(302);

      const origin = new URL(hostname).origin;
      const deviceDecision = await fetch(`${hostname}/oauth/device`, {
        method: "POST",
        redirect: "manual",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({ user_code: "ABCD-EFGH", decision: "allow" }),
      });
      expect(deviceDecision.status).toBe(401);

      // A session reaches the page rather than the login redirect.
      const asSession = await call("GET", "/oauth/device", sessionToken);
      expect(asSession.status).toBe(200);
    });
  });
});
