import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { $issuer, $permission, $secure, AlephaSecurity } from "alepha/security";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { LinkProvider, ServerLinksProvider } from "../index.ts";

describe("ServerLinksProvider", () => {
  describe("secured field in links", () => {
    it("should set secured=undefined for public actions (no $secure middleware)", async ({
      expect,
    }) => {
      class App {
        publicAction = $action({
          handler: () => "PUBLIC",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const links = alepha.inject(LinkProvider).getServerLinks();
      const link = links.find((l) => l.name === "publicAction");

      expect(link).toBeDefined();
      expect(link?.secured).toBeUndefined();
    });

    it("should set secured=true for actions with $secure()", async ({
      expect,
    }) => {
      class App {
        securedAction = $action({
          use: [$secure()],
          handler: () => "SECURED",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const links = alepha.inject(LinkProvider).getServerLinks();
      const link = links.find((l) => l.name === "securedAction");

      expect(link).toBeDefined();
      expect(link?.secured).toBe(true);
    });

    it("should set secured to options object for realm-secured actions", async ({
      expect,
    }) => {
      class App {
        realmAction = $action({
          use: [$secure({ issuers: ["admin"] })],
          handler: () => "REALM",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const links = alepha.inject(LinkProvider).getServerLinks();
      const link = links.find((l) => l.name === "realmAction");

      expect(link).toBeDefined();
      expect(link?.secured).toEqual({ issuers: ["admin"] });
    });
  });

  describe("/_links endpoint with security", () => {
    it("should return public actions to unauthenticated users", async ({
      expect,
    }) => {
      class App {
        publicAction = $action({
          schema: { response: z.text() },
          handler: () => "PUBLIC",
        });
        issuer = $issuer({
          secret: "test",
          roles: [{ name: "user", permissions: [{ name: "*" }] }],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      const res = await fetch(
        `${alepha.inject(ServerProvider).hostname}/api/_links`,
      );
      const data = await res.json();

      expect(data.actions.publicAction).toBeDefined();
      expect(data.actions.publicAction.path).toBe("/publicAction");
    });

    it("should NOT return secured actions to unauthenticated users", async ({
      expect,
    }) => {
      class App {
        securedAction = $action({
          use: [$secure()],
          schema: { response: z.text() },
          handler: () => "SECURED",
        });
        issuer = $issuer({
          secret: "test",
          roles: [{ name: "user", permissions: [{ name: "*" }] }],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      const res = await fetch(
        `${alepha.inject(ServerProvider).hostname}/api/_links`,
      );
      const data = await res.json();

      expect(data.actions.securedAction).toBeUndefined();
    });

    it("should return secured actions to authenticated users with permissions", async ({
      expect,
    }) => {
      class App {
        securedAction = $action({
          use: [$secure()],
          schema: { response: z.text() },
          handler: () => "SECURED",
        });
        issuer = $issuer({
          secret: "test",
          roles: [{ name: "user", permissions: [{ name: "*" }] }],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      // Use HttpClient to get a token automatically in test mode
      const app = alepha.inject(App);
      const { data } = await app.securedAction.fetch(
        {},
        {
          user: { id: randomUUID(), roles: ["user"] },
        },
      );
      expect(data).toBe("SECURED");
    });

    it("should return both public and secured actions when user is authenticated", async ({
      expect,
    }) => {
      class App {
        publicAction = $action({
          schema: { response: z.text() },
          handler: () => "PUBLIC",
        });
        securedAction = $action({
          use: [$secure()],
          schema: { response: z.text() },
          handler: () => "SECURED",
        });
        issuer = $issuer({
          secret: "test",
          roles: [{ name: "user", permissions: [{ name: "*" }] }],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      const linksProvider = alepha.inject(ServerLinksProvider);
      const user = { id: randomUUID(), roles: ["user"] };

      const registry = await linksProvider.getUserApiLinks({ user });

      expect(registry.actions.publicAction).toBeDefined();
      expect(registry.actions.securedAction).toBeDefined();
    });

    it("should filter secured actions based on explicit permissions", async ({
      expect,
    }) => {
      class App {
        adminOnly = $action({
          use: [$secure({ permissions: ["admin:manage"] })],
          schema: { response: z.text() },
          handler: () => "ADMIN",
        });
        userAction = $action({
          use: [$secure({ permissions: ["user:read"] })],
          schema: { response: z.text() },
          handler: () => "USER",
        });
        issuer = $issuer({
          secret: "test",
          roles: [
            { name: "admin", permissions: [{ name: "*" }] },
            { name: "user", permissions: [{ name: "user:*" }] },
          ],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      const linksProvider = alepha.inject(ServerLinksProvider);

      // User with "user" role should only see userAction
      const userRegistry = await linksProvider.getUserApiLinks({
        user: { id: randomUUID(), roles: ["user"] },
      });

      expect(userRegistry.actions.userAction).toBeDefined();
      expect(userRegistry.actions.adminOnly).toBeUndefined();

      // User with "admin" role should see both
      const adminRegistry = await linksProvider.getUserApiLinks({
        user: { id: randomUUID(), roles: ["admin"] },
      });

      expect(adminRegistry.actions.userAction).toBeDefined();
      expect(adminRegistry.actions.adminOnly).toBeDefined();
    });

    it("should show auth-only $secure() actions to any authenticated user", async ({
      expect,
    }) => {
      class App {
        authOnly = $action({
          use: [$secure()],
          schema: { response: z.text() },
          handler: () => "AUTH_ONLY",
        });
        issuer = $issuer({
          secret: "test",
          roles: [{ name: "limited", permissions: [] }],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      const linksProvider = alepha.inject(ServerLinksProvider);

      // User with "limited" role (no permissions) should still see auth-only actions
      const registry = await linksProvider.getUserApiLinks({
        user: { id: randomUUID(), roles: ["limited"] },
      });

      expect(registry.actions.authOnly).toBeDefined();
    });
  });

  describe("mixed public and secured actions", () => {
    it("should correctly differentiate public from secured in server links", async ({
      expect,
    }) => {
      class App {
        getUsers = $action({
          path: "/users",
          schema: { response: z.array(z.text()) },
          handler: () => ["user1", "user2"],
        });
        createUser = $action({
          path: "/users",
          use: [$secure()],
          schema: {
            body: z.object({ name: z.text() }),
            response: z.text(),
          },
          handler: ({ body }) => body.name,
        });
        deleteUser = $action({
          method: "DELETE",
          path: "/users/:id",
          use: [$secure()],
          schema: {
            params: z.object({ id: z.text() }),
            response: z.void(),
          },
          handler: () => {},
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const links = alepha.inject(LinkProvider).getServerLinks();

      const getUsers = links.find((l) => l.name === "getUsers");
      const createUser = links.find((l) => l.name === "createUser");
      const deleteUser = links.find((l) => l.name === "deleteUser");

      // getUsers is public (no $secure middleware)
      expect(getUsers?.secured).toBeUndefined();

      // createUser and deleteUser are secured
      expect(createUser?.secured).toBe(true);
      expect(deleteUser?.secured).toBe(true);
    });
  });

  describe("permissions in registry", () => {
    it("should separate virtual permissions from actions", async ({
      expect,
    }) => {
      class App {
        getUsers = $action({
          path: "/users",
          schema: { response: z.array(z.text()) },
          handler: () => [],
        });
        teamManagement = $permission({
          name: "TeamManagement",
          group: "team",
        });
        issuer = $issuer({
          secret: "test",
          roles: [
            {
              name: "admin",
              permissions: [{ name: "*" }, { name: "team:TeamManagement" }],
            },
          ],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      const linksProvider = alepha.inject(ServerLinksProvider);
      const registry = await linksProvider.getUserApiLinks({
        user: { id: randomUUID(), roles: ["admin"] },
      });

      // Virtual permissions should be in the permissions array, not in actions
      expect(registry.permissions).toContain("team:TeamManagement");
      expect(registry.actions.TeamManagement).toBeUndefined();

      // Real actions should be in the actions map
      expect(registry.actions.getUsers).toBeDefined();
    });
  });

  describe("schemas endpoint", () => {
    it("should return schemas for requested actions", async ({ expect }) => {
      class App {
        ping = $action({
          schema: {
            body: z.object({ message: z.text() }),
            response: z.object({ pong: z.boolean() }),
          },
          handler: () => ({ pong: true }),
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const res = await fetch(
        `${alepha.inject(ServerProvider).hostname}/api/_links/schemas`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actions: ["ping"] }),
        },
      );

      const data = await res.json();

      expect(data.ping).toBeDefined();
      expect(data.ping.body).toBeDefined();
      expect(data.ping.response).toBeDefined();
      expect(JSON.parse(data.ping.body).type).toBe("object");
      expect(JSON.parse(data.ping.response).type).toBe("object");
    });

    it("should return empty for unknown actions", async ({ expect }) => {
      class App {
        ping = $action({
          schema: { response: z.text() },
          handler: () => "pong",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const res = await fetch(
        `${alepha.inject(ServerProvider).hostname}/api/_links/schemas`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actions: ["nonexistent"] }),
        },
      );

      const data = await res.json();

      expect(data.nonexistent).toBeUndefined();
    });

    it("should filter based on user permissions", async ({ expect }) => {
      class App {
        publicAction = $action({
          schema: {
            body: z.object({ name: z.text() }),
            response: z.text(),
          },
          handler: () => "PUBLIC",
        });
        securedAction = $action({
          use: [$secure()],
          schema: {
            body: z.object({ secret: z.text() }),
            response: z.text(),
          },
          handler: () => "SECURED",
        });
        issuer = $issuer({
          secret: "test",
          roles: [{ name: "user", permissions: [{ name: "*" }] }],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      // Unauthenticated request — should only get public schema
      const res = await fetch(
        `${alepha.inject(ServerProvider).hostname}/api/_links/schemas`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            actions: ["publicAction", "securedAction"],
          }),
        },
      );

      const data = await res.json();

      expect(data.publicAction).toBeDefined();
      expect(data.securedAction).toBeUndefined();
    });
  });

  describe("caching and ETag", () => {
    it("should return ETag header on first request", async ({ expect }) => {
      class App {
        ping = $action({
          handler: () => "pong",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const res = await fetch(
        `${alepha.inject(ServerProvider).hostname}/api/_links`,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("etag")).toBeDefined();
      expect(res.headers.get("etag")).toMatch(/^"[a-f0-9]{32}"$/);
    });

    it("should return 304 when If-None-Match matches ETag", async ({
      expect,
    }) => {
      class App {
        ping = $action({
          handler: () => "pong",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const hostname = alepha.inject(ServerProvider).hostname;

      // First request — get the ETag
      const res1 = await fetch(`${hostname}/api/_links`);
      const etag = res1.headers.get("etag")!;
      expect(etag).toBeDefined();

      // Second request with If-None-Match — should get 304
      const res2 = await fetch(`${hostname}/api/_links`, {
        headers: { "if-none-match": etag },
      });

      expect(res2.status).toBe(304);
      expect(res2.headers.get("etag")).toBe(etag);
    });

    it("should return same ETag for same roles", async ({ expect }) => {
      class App {
        ping = $action({
          handler: () => "pong",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const hostname = alepha.inject(ServerProvider).hostname;

      const res1 = await fetch(`${hostname}/api/_links`);
      const res2 = await fetch(`${hostname}/api/_links`);

      expect(res1.headers.get("etag")).toBe(res2.headers.get("etag"));
    });

    it("should not serve the anonymous registry to an authenticated user with no roles", async ({
      expect,
    }) => {
      class App {
        authOnly = $action({
          use: [$secure()],
          schema: { response: z.text() },
          handler: () => "AUTH_ONLY",
        });
        issuer = $issuer({
          secret: "test",
          roles: [{ name: "user", permissions: [{ name: "*" }] }],
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with(ServerLinksProvider)
        .with(AlephaSecurity);
      await alepha.start();

      const hostname = alepha.inject(ServerProvider).hostname;

      // Anonymous request first — populates the cache entry for "no roles"
      const anon = await (await fetch(`${hostname}/api/_links`)).json();
      expect(anon.actions.authOnly).toBeUndefined();

      // Authenticated user carrying an empty role set must not reuse it:
      // $secure() is auth-only, so this user IS allowed to see the action.
      const { access_token } = await alepha
        .inject(App)
        .issuer.createToken({ id: randomUUID(), roles: [] });

      const authed = await (
        await fetch(`${hostname}/api/_links`, {
          headers: { authorization: `Bearer ${access_token}` },
        })
      ).json();

      expect(authed.actions.authOnly).toBeDefined();
    });

    it("should serve cached response on second request", async ({ expect }) => {
      class App {
        ping = $action({
          schema: { response: z.text() },
          handler: () => "pong",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const hostname = alepha.inject(ServerProvider).hostname;

      // First request populates cache
      const res1 = await fetch(`${hostname}/api/_links`);
      const data1 = await res1.json();

      // Second request should use cache
      const res2 = await fetch(`${hostname}/api/_links`);
      const data2 = await res2.json();

      expect(data1).toStrictEqual(data2);
      expect(data1.actions.ping).toBeDefined();
    });
  });
});
