import { Alepha, z } from "alepha";
import type { Duration } from "alepha/datetime";
import { $issuer, $secure } from "alepha/security";
import { $route, ServerProvider } from "alepha/server";
import { MockOidcServer } from "alepha/testing/oidc";
import { describe, expect, it } from "vitest";

import { serverAuthOptions } from "../atoms/serverAuthOptions.ts";
import { $auth } from "../primitives/$auth.ts";
import { ServerAuthProvider } from "../providers/ServerAuthProvider.ts";
import type { Tokens } from "../schemas/tokensSchema.ts";
import { SessionStore } from "../services/SessionStore.ts";

/**
 * The optional server-side session store: the cookie holds an opaque id,
 * the tokens stay on the server, encrypted.
 */

class RecordingSessionStore extends SessionStore {
  public readonly ids: string[] = [];

  public override async set(
    id: string,
    tokens: Tokens,
    ttl: Duration,
  ): Promise<void> {
    if (!this.ids.includes(id)) {
      this.ids.push(id);
    }
    await super.set(id, tokens, ttl);
  }

  public raw(id: string): Promise<string | undefined> {
    return this.sessions.get(id);
  }
}

class Browser {
  public readonly jar = new Map<string, string>();

  public async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: {
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      if (value === "" || attributes.some((it) => /max-age=0/i.test(it))) {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
    return response;
  }

  public async follow(url: string): Promise<Response> {
    let response = await this.fetch(url);
    while (response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get("location")!, url).toString();
      response = await this.fetch(url);
    }
    return response;
  }
}

const boot = async (sessionStore: boolean) => {
  const idp = await MockOidcServer.start();

  class App {
    keycloak = $auth({
      oidc: { issuer: idp.issuer, clientId: "alepha" },
    });
    issuer = $issuer({ name: "keycloak", oidc: () => this.keycloak });
    me = $route({
      path: "/me",
      use: [$secure()],
      schema: { response: z.object({ id: z.text() }) },
      handler: ({ user }) => ({ id: user!.id }),
    });
  }

  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.store.set(serverAuthOptions, { sessionStore });
  if (sessionStore) {
    alepha.with({ provide: SessionStore, use: RecordingSessionStore });
  }
  alepha.with(App);
  alepha.with(ServerAuthProvider);
  await alepha.start();

  const hostname = alepha.inject(ServerProvider).hostname;
  const browser = new Browser();
  const signIn = () =>
    browser.follow(
      `${hostname}/oauth/login?provider=keycloak&redirect_uri=/me`,
    );
  const me = () => browser.fetch(`${hostname}/me`);
  const cookie = () => browser.jar.get("app.tokens");
  const store = () => alepha.inject(RecordingSessionStore);

  return { alepha, idp, hostname, browser, signIn, me, cookie, store };
};

describe("the session store, on", () => {
  it("keeps the tokens on the server, encrypted, and an opaque id in the cookie", async () => {
    const { signIn, cookie, store } = await boot(true);

    expect((await signIn()).status).toBe(200);

    // The provider's three JWTs would not fit in this.
    expect(cookie()!.length).toBeLessThan(400);
    const [id] = store().ids;
    const raw = await store().raw(id!);
    expect(raw).toBeTruthy();
    const tokens = await store().get(id!);
    expect(tokens?.access_token).toMatch(/^eyJ/);
    // Not "eyJ" alone: the ciphertext is random base64url, and holds any
    // given three characters about once in a hundred runs (#Q3550). A JWT's
    // header and payload segments, 20 characters and more, never by chance.
    const [header, payload] = tokens!.access_token.split(".");
    expect(raw).not.toContain(header);
    expect(raw).not.toContain(payload);
  });

  it("keeps the id across a refresh, and gives a new sign-in a new one", async () => {
    const { idp, signIn, me, cookie, store } = await boot(true);
    // Under the refresh grace period: every request refreshes.
    idp.configure({ accessTokenTtl: 5 });
    await signIn();
    const signedIn = cookie();

    expect((await me()).status).toBe(200);
    expect(idp.calls.some((it) => it.grantType === "refresh_token")).toBe(true);
    expect(store().ids).toHaveLength(1);
    expect(cookie()).toBeTruthy();

    idp.configure({});
    await signIn();
    expect(store().ids).toHaveLength(2);
    expect(await store().get(store().ids[0]!)).toBeUndefined();
    expect(cookie()).not.toBe(signedIn);
  });

  it("ends a session server-side by its id", async () => {
    const { alepha, signIn, me, browser, store } = await boot(true);
    await signIn();

    await alepha.inject(ServerAuthProvider).endSession(store().ids[0]!);

    expect((await me()).status).toBe(401);
    expect(browser.jar.size).toBe(0);
  });

  it("signs out a visitor whose entry is gone", async () => {
    const { signIn, me, browser, store } = await boot(true);
    await signIn();

    await store().delete(store().ids[0]!);

    expect((await me()).status).toBe(401);
    expect(browser.jar.size).toBe(0);
  });

  it("deletes its own entry on logout", async () => {
    const { hostname, signIn, browser, store } = await boot(true);
    await signIn();

    await browser.fetch(`${hostname}/oauth/logout`, {
      method: "POST",
      headers: { origin: hostname },
    });

    expect(await store().get(store().ids[0]!)).toBeUndefined();
  });
});

describe("the session store, off", () => {
  it("keeps the stateless cookie and registers no store", async () => {
    const { alepha, signIn, me, cookie } = await boot(false);

    expect((await signIn()).status).toBe(200);
    expect((await me()).status).toBe(200);
    expect(cookie()!.length).toBeGreaterThan(400);
    expect(alepha.has(SessionStore)).toBe(false);
  });
});
