import { $pipeline, Alepha } from "alepha";
import { describe, it } from "vitest";

import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import { $secure } from "../primitives/$secure.browser.ts";

describe("$secure (browser)", () => {
  describe("authentication", () => {
    it("should return undefined when no user is authenticated", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure()],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      expect(await app.fn()).toBeUndefined();
    });

    it("should call handler when user is authenticated", async ({ expect }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure()],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        expect(await app.fn()).toBe("ok");
      });
    });
  });

  describe("roles", () => {
    it("should return undefined when user lacks required role", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ roles: ["admin"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, {
          id: "1",
          name: "Alice",
          roles: ["user"],
        });
        expect(await app.fn()).toBeUndefined();
      });
    });

    it("should call handler when user has required role", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ roles: ["admin"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, {
          id: "1",
          name: "Alice",
          roles: ["admin"],
        });
        expect(await app.fn()).toBe("ok");
      });
    });

    it("should pass when user has any of the required roles", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ roles: ["admin", "editor"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, {
          id: "1",
          name: "Alice",
          roles: ["editor"],
        });
        expect(await app.fn()).toBe("ok");
      });
    });
  });

  describe("issuers", () => {
    it("should return undefined when user realm does not match", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ issuers: ["github"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, {
          id: "1",
          name: "Alice",
          realm: "google",
        });
        expect(await app.fn()).toBeUndefined();
      });
    });

    it("should call handler when user realm matches", async ({ expect }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ issuers: ["github"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, {
          id: "1",
          name: "Alice",
          realm: "github",
        });
        expect(await app.fn()).toBe("ok");
      });
    });
  });

  /**
   * Permissions were previously not checked here at all — only a comment stood
   * where the check belongs, on the grounds that the API registry had already
   * filtered actions by permission. That holds for a `$client` virtual action,
   * whose call site *is* the registry lookup, but not for `$secure` wrapping an
   * arbitrary handler, where the guard silently admitted every signed-in user.
   *
   * The permission set arrives with the API registry the server sends on
   * login/ping, which is what `LinkProvider` resolves against.
   */
  describe("permissions", () => {
    const withRegistry = (alepha: Alepha, permissions: string[]) =>
      alepha.store.set("alepha.server.request.apiLinks", {
        actions: {},
        permissions,
      });

    it("should return undefined when user lacks the required permission", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ permissions: ["orders:delete"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        withRegistry(alepha, ["orders:read"]);
        expect(await app.fn()).toBeUndefined();
      });
    });

    it("should call handler when user has the required permission", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ permissions: ["orders:delete"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        withRegistry(alepha, ["orders:delete"]);
        expect(await app.fn()).toBe("ok");
      });
    });

    it("should require ALL permissions, not any", async ({ expect }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ permissions: ["orders:read", "orders:delete"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        withRegistry(alepha, ["orders:read"]);
        expect(await app.fn()).toBeUndefined();
      });
    });

    /**
     * The wildcard belongs on the *requirement*, not the grant. The server
     * resolves a user's roles into concrete permission names before sending
     * them (`SecurityProvider.getPermissions`, where a `*` role expands to the
     * full list), so the registry never carries a `*` for the browser to match
     * against — but a guard may still ask "anything under this group?".
     */
    it("should match a wildcard requirement against concrete grants", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ permissions: ["orders:*"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        withRegistry(alepha, ["orders:delete"]);
        expect(await app.fn()).toBe("ok");
      });
    });

    it("should deny a wildcard requirement when nothing in the group is granted", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ permissions: ["orders:*"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        withRegistry(alepha, ["invoices:read"]);
        expect(await app.fn()).toBeUndefined();
      });
    });

    it("should accept a Permission object, not only a string", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ permissions: [{ name: "orders:delete" }] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        withRegistry(alepha, ["orders:delete"]);
        expect(await app.fn()).toBe("ok");
      });
    });

    it("should deny before the registry has arrived", async ({ expect }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ permissions: ["orders:delete"] })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        // Signed in, but no registry yet (pre-`ping`). Denying is the safe
        // direction: the UI stays closed until the server has said otherwise.
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        expect(await app.fn()).toBeUndefined();
      });
    });
  });

  describe("guard", () => {
    it("should return undefined when guard returns false", async ({
      expect,
    }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ guard: () => false })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        expect(await app.fn()).toBeUndefined();
      });
    });

    it("should call handler when guard returns true", async ({ expect }) => {
      const alepha = Alepha.create();

      class App {
        fn = $pipeline({
          use: [$secure({ guard: () => true })],
          handler: async () => "ok",
        });
      }

      const app = alepha.inject(App);
      await alepha.start();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, { id: "1", name: "Alice" });
        expect(await app.fn()).toBe("ok");
      });
    });
  });
});
