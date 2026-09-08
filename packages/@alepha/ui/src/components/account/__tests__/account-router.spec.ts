import { Alepha, OPTIONS } from "alepha";
import {
  $page,
  AlephaReactRouter,
  type PagePrimitive,
} from "alepha/react/router";
import { describe, expect, it } from "vitest";

import { AdminRouter } from "../../admin/admin-router.tsx";
import type { NavMeta } from "../../nav-shell/nav-tree-util.ts";
import { accountRouterOptionsAtom } from "../account-router-options.tsx";
import { $pageAccount } from "../account-router-page.tsx";
import { AccountRouter } from "../account-router.tsx";

/**
 * Reads the permissions a page's route gate actually enforces — see
 * `admin-router.spec.ts` for why this reads the gate back rather than the
 * `permission` option a page was built from.
 */
const permissionsOf = (page: PagePrimitive): string[] => {
  const required: string[] = [];
  for (const middleware of page.options.use ?? []) {
    const metadata = middleware[OPTIONS];
    if (metadata?.name !== "$secure") {
      continue;
    }
    const permissions = (
      metadata.options as
        | { permissions?: Array<string | { name: string }> }
        | undefined
    )?.permissions;
    for (const permission of permissions ?? []) {
      required.push(
        typeof permission === "string" ? permission : permission.name,
      );
    }
  }
  return required;
};

describe("AccountRouter", () => {
  const mount = async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AccountRouter);
    await alepha.start();
    return alepha
      .primitives($page)
      .map((page) => ({ path: page.options.path, name: page.name }));
  };

  it("mounts the shell and its five pages", async () => {
    const pages = await mount();

    expect(pages).toEqual(
      expect.arrayContaining([
        { path: "/account", name: "account" },
        { path: "/", name: "accountProfile" },
        { path: "/security", name: "accountSecurity" },
        { path: "/sessions", name: "accountSessions" },
        { path: "/keys", name: "accountKeys" },
        { path: "/connections", name: "accountConnections" },
      ]),
    );
  });

  it("gates the shell on being signed in, and nothing more", async () => {
    /*
      An account area needs a session and no permission. Requiring one would
      mean every realm has to remember to grant it, and the failure mode is a
      page that renders empty for users nobody thought to configure.
    */
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AccountRouter);
    await alepha.start();

    expect(permissionsOf(router.layout)).toEqual([]);
    expect(router.layout.options.use?.length).toBe(1);
  });

  it("gates every page on an action rather than a permission", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AccountRouter);
    await alepha.start();

    // An empty registry: no action exists for any page to be granted.
    alepha.store.set("alepha.server.request.apiLinks", { actions: {} });

    const pages = [
      router.profile,
      router.security,
      router.sessions,
      router.keys,
      router.connections,
    ];

    for (const page of pages) {
      expect(page.options.can).toBeDefined();
      // `has` grants every permission-shaped name. A `can` derived from a
      // permission would answer true here; these must not, because the whole
      // point is "is this module mounted", which a permission cannot answer.
      expect(page.options.can!({ has: (name) => name.includes(":") })).toBe(
        false,
      );
    }
  });

  it("hides only the pages whose backing action is absent", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AccountRouter);
    await alepha.start();

    // The keys module is the realistic absentee: an application can mount
    // users without ever mounting AlephaApiKeys, and then the page must go.
    // (Connections is no longer such a case — `MyConnectionController` lives
    // in `api/users` to avoid a module cycle, so it ships with the rest.)
    alepha.store.set("alepha.server.request.apiLinks", {
      actions: {
        getMyProfile: { path: "/users/me" },
        listMyIdentities: { path: "/users/me/identities" },
        listMySessions: { path: "/users/me/sessions" },
        listMyConnections: { path: "/users/me/connections" },
      },
    });

    expect(router.profile.options.can!({ has: () => true })).toBe(true);
    expect(router.security.options.can!({ has: () => true })).toBe(true);
    expect(router.sessions.options.can!({ has: () => true })).toBe(true);
    expect(router.connections.options.can!({ has: () => true })).toBe(true);
    expect(router.keys.options.can!({ has: () => true })).toBe(false);
  });

  /**
   * `hide`, for the page `can` cannot answer for.
   *
   * The test above names the gap in passing: `MyConnectionController` lives
   * in `api/users`, so `listMyConnections` ships with `$realm` and the
   * Connected apps page is offered by every application ever built on this
   * router - including a public service with no OAuth client in the world,
   * over a list that is empty by construction.
   *
   * ⚠️ These assert on `can`, which is what the rail is built from, and that
   * is the whole of what hiding does. `can` is a UI-affordance predicate and
   * NOT a route guard - `ReactBrowserRouterProvider` says so and
   * deliberately does not block routing on it - so a hidden page is still
   * reachable by typing its URL. That is not a hole this option opens: it is
   * exactly what a page whose action is missing already does, which is the
   * parity the option was asked for.
   */
  describe("hide", () => {
    const mountWith = async (hide?: string[]) => {
      const alepha = Alepha.create().with(AlephaReactRouter);
      if (hide) {
        alepha.store.set(accountRouterOptionsAtom, { hide } as never);
      }
      const router = alepha.inject(AccountRouter);
      await alepha.start();
      // Every action mounted, so nothing else can be what turns a page off.
      alepha.store.set("alepha.server.request.apiLinks", {
        actions: {
          getMyProfile: { path: "/users/me" },
          listMyIdentities: { path: "/users/me/identities" },
          listMySessions: { path: "/users/me/sessions" },
          listApiKeys: { path: "/api-keys" },
          listMyConnections: { path: "/users/me/connections" },
        },
      });
      return router;
    };

    it("drops a named page from the rail while every action is mounted", async () => {
      const router = await mountWith(["connections"]);

      expect(router.connections.options.can!({ has: () => true })).toBe(false);
    });

    it("leaves every page it does not name alone", async () => {
      const router = await mountWith(["connections"]);

      expect(router.profile.options.can!({ has: () => true })).toBe(true);
      expect(router.security.options.can!({ has: () => true })).toBe(true);
      expect(router.sessions.options.can!({ has: () => true })).toBe(true);
      expect(router.keys.options.can!({ has: () => true })).toBe(true);
    });

    it("changes nothing when it is unset", async () => {
      // Backwards compatible by construction: every application written
      // before this option keeps all five pages.
      const router = await mountWith();

      for (const page of [
        router.profile,
        router.security,
        router.sessions,
        router.keys,
        router.connections,
      ]) {
        expect(page.options.can!({ has: () => true })).toBe(true);
      }
    });

    it("takes several pages, and is ANDed rather than replacing the action gate", async () => {
      const alepha = Alepha.create().with(AlephaReactRouter);
      alepha.store.set(accountRouterOptionsAtom, {
        hide: ["connections", "sessions"],
      } as never);
      const router = alepha.inject(AccountRouter);
      await alepha.start();
      // Keys is absent from the registry AND unnamed by `hide`: the two
      // gates answer independently, and either one is enough.
      alepha.store.set("alepha.server.request.apiLinks", {
        actions: {
          getMyProfile: { path: "/users/me" },
          listMyIdentities: { path: "/users/me/identities" },
          listMySessions: { path: "/users/me/sessions" },
          listMyConnections: { path: "/users/me/connections" },
        },
      });

      expect(router.connections.options.can!({ has: () => true })).toBe(false);
      expect(router.sessions.options.can!({ has: () => true })).toBe(false);
      expect(router.keys.options.can!({ has: () => true })).toBe(false);
      expect(router.profile.options.can!({ has: () => true })).toBe(true);
    });
  });

  /**
   * Same rule as `AdminRouter`: a class field is evaluated once, outside
   * React, so the rail follows a language switch only through the key. See
   * `admin-router.spec.ts`.
   */
  it("names a catalogue key for every label and every group heading", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AccountRouter);
    await alepha.start();

    const navs = alepha
      .primitives($page)
      .map((page) => page.options.nav as NavMeta | undefined)
      .filter((nav): nav is NavMeta => nav !== undefined);

    expect(navs.length).toBeGreaterThan(0);
    for (const nav of navs) {
      expect(nav.labelKey).toMatch(/^account\.nav\./);
      if (nav.group) {
        expect(nav.groupKey).toMatch(/^account\.nav\.group\./);
      }
    }
  });

  it("does not collide with the admin router's route names", async () => {
    /*
      The reason every name here is prefixed. `AdminRouter` claims `sessions`
      and `keys` globally, and `ReactPageProvider.page()` returns the FIRST
      match on a duplicate — so bare names would shadow one side or the other
      depending on mount order, silently.
    */
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AdminRouter);
    alepha.inject(AccountRouter);
    await alepha.start();

    const names = alepha.primitives($page).map((page) => page.name);
    const duplicates = names.filter(
      (name, index) => names.indexOf(name) !== index,
    );

    expect(duplicates).toEqual([]);
  });

  it("puts the profile at the shell root so bare /account resolves", async () => {
    // The shell-root convention, shared with `/admin`'s dashboard: an index
    // child at `path: "/"` rather than a redirect picking a first page.
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AccountRouter);
    await alepha.start();

    expect(router.profile.options.path).toBe("/");
    expect(router.profile.options.parent).toBe(router.layout);
  });

  it("lets an application hang its own page off the shell", async () => {
    class LoreAccountRouter {
      invitations = $pageAccount({
        path: "/invitations",
        name: "accountInvitations",
        nav: { label: "Invitations", group: "Lore", order: 100 },
        component: () => "invitations",
      });
    }

    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.with(LoreAccountRouter);
    await alepha.start();

    const page = alepha
      .primitives($page)
      .find((it) => it.name === "accountInvitations");

    expect(page).toBeDefined();
    expect(page!.options.parent).toBe(alepha.inject(AccountRouter).layout);
  });

  it("registers the whole shell from a single $pageAccount call", async () => {
    // Declaring one page this way must mount the built-ins too — an account
    // page without the account area around it is not a thing.
    class LoreAccountRouter {
      invitations = $pageAccount({
        path: "/invitations",
        name: "accountInvitations",
        component: () => "invitations",
      });
    }

    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.with(LoreAccountRouter);
    await alepha.start();

    const names = alepha.primitives($page).map((page) => page.name);
    expect(names).toEqual(
      expect.arrayContaining(["account", "accountProfile", "accountSessions"]),
    );
  });
});
