import { $pipeline, Alepha } from "alepha";
import { describe, it } from "vitest";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import { $secure } from "./$secure.browser.ts";

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
