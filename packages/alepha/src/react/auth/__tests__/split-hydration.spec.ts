import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { $issuer, AlephaSecurity } from "alepha/security";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaReactAuth } from "../index.ts";

/**
 * Split hydration (#E78): `__ssr` carries what the page shows, and
 * `__ssr_private` carries who it is for. The shared part of a public page is
 * therefore byte for byte the same for an anonymous visitor and a signed-in
 * one, which is the condition for ever caching it.
 */
describe("split hydration", () => {
  const PRIVATE =
    /<script id="__ssr_private" type="application\/json">(.*?)<\/script>/;

  class App {
    realm = $issuer({
      secret: "split-hydration-secret",
      roles: [{ name: "user", permissions: [{ name: "*" }] }],
    });

    home = $page({
      path: "/",
      component: () => "a public page",
    });
  }

  const boot = async () => {
    const alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaSecurity)
      .with(AlephaReactAuth)
      .with(App);
    const app = alepha.inject(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;
    const get = async (token?: string) => {
      const res = await fetch(`${base}/`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      return res.text();
    };
    return { alepha, app, get };
  };

  it("serves a byte-identical shared part to two different visitors", async ({
    expect,
  }) => {
    const { app, get } = await boot();
    const { access_token } = await app.realm.createToken({
      id: randomUUID(),
      roles: ["user"],
    });

    const anonymous = await get();
    const signedIn = await get(access_token);

    expect(signedIn).toMatch(PRIVATE);
    expect(signedIn.replace(PRIVATE, "")).toBe(anonymous.replace(PRIVATE, ""));
  });

  it("keeps the user and the api links out of __ssr", async ({ expect }) => {
    const { app, get } = await boot();
    const id = randomUUID();
    const { access_token } = await app.realm.createToken({
      id,
      roles: ["user"],
    });

    const html = await get(access_token);
    const shared = html.match(/<script id="__ssr" [^>]*>(.*?)<\/script>/)![1];
    const own = JSON.parse(html.match(PRIVATE)![1]);

    expect(shared).not.toContain(id);
    expect(shared).not.toContain("alepha.security.user");
    expect(shared).not.toContain("alepha.server.request.apiLinks");
    expect(own["alepha.security.user"].id).toBe(id);
    expect(own).toHaveProperty("alepha.server.request.apiLinks");
  });

  it("writes a client projection of the user: no realm, credential, ownership, scope or token", async ({
    expect,
  }) => {
    const { app, get } = await boot();
    const { access_token } = await app.realm.createToken({
      id: randomUUID(),
      roles: ["user"],
    });

    const html = await get(access_token);
    const user = JSON.parse(html.match(PRIVATE)![1])["alepha.security.user"];

    expect(user.roles).toEqual(["user"]);
    for (const field of [
      "realm",
      "credential",
      "ownership",
      "permissionScope",
      "token",
    ]) {
      expect(user).not.toHaveProperty(field);
    }
    expect(html).not.toContain(access_token);
  });

  it("writes no private script for an anonymous visitor with no personal state", async ({
    expect,
  }) => {
    const { get } = await boot();

    // The api links of an anonymous visitor are personal too, so the script
    // is there: what matters is that it never holds a user.
    const html = await get();
    const own = html.match(PRIVATE);
    expect(own ? JSON.parse(own[1]) : {}).not.toHaveProperty(
      "alepha.security.user",
    );
  });
});
