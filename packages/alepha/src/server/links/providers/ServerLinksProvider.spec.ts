import { randomUUID } from "node:crypto";
import { Alepha, t } from "alepha";
import { $issuer, $secure, AlephaSecurity } from "alepha/security";
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
          schema: { response: t.text() },
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

      expect(data.links).toContainEqual(
        expect.objectContaining({
          name: "publicAction",
          path: "/publicAction",
        }),
      );
    });

    it("should NOT return secured actions to unauthenticated users", async ({
      expect,
    }) => {
      class App {
        securedAction = $action({
          use: [$secure()],
          schema: { response: t.text() },
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

      expect(data.links).not.toContainEqual(
        expect.objectContaining({
          name: "securedAction",
        }),
      );
    });

    it("should return secured actions to authenticated users with permissions", async ({
      expect,
    }) => {
      class App {
        securedAction = $action({
          use: [$secure()],
          schema: { response: t.text() },
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
          schema: { response: t.text() },
          handler: () => "PUBLIC",
        });
        securedAction = $action({
          use: [$secure()],
          schema: { response: t.text() },
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

      const { links } = await linksProvider.getUserApiLinks({ user });

      expect(links).toContainEqual(
        expect.objectContaining({ name: "publicAction" }),
      );
      expect(links).toContainEqual(
        expect.objectContaining({ name: "securedAction" }),
      );
    });

    it("should filter secured actions based on explicit permissions", async ({
      expect,
    }) => {
      class App {
        adminOnly = $action({
          use: [$secure({ permissions: ["admin:manage"] })],
          schema: { response: t.text() },
          handler: () => "ADMIN",
        });
        userAction = $action({
          use: [$secure({ permissions: ["user:read"] })],
          schema: { response: t.text() },
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

      // User with "user" role should only see userAction (has user:* which matches user:read)
      const userLinks = await linksProvider.getUserApiLinks({
        user: { id: randomUUID(), roles: ["user"] },
      });

      expect(userLinks.links).toContainEqual(
        expect.objectContaining({ name: "userAction" }),
      );
      expect(userLinks.links).not.toContainEqual(
        expect.objectContaining({ name: "adminOnly" }),
      );

      // User with "admin" role should see both (wildcard *)
      const adminLinks = await linksProvider.getUserApiLinks({
        user: { id: randomUUID(), roles: ["admin"] },
      });

      expect(adminLinks.links).toContainEqual(
        expect.objectContaining({ name: "userAction" }),
      );
      expect(adminLinks.links).toContainEqual(
        expect.objectContaining({ name: "adminOnly" }),
      );
    });

    it("should show auth-only $secure() actions to any authenticated user", async ({
      expect,
    }) => {
      class App {
        authOnly = $action({
          use: [$secure()],
          schema: { response: t.text() },
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
      const links = await linksProvider.getUserApiLinks({
        user: { id: randomUUID(), roles: ["limited"] },
      });

      expect(links.links).toContainEqual(
        expect.objectContaining({ name: "authOnly" }),
      );
    });
  });

  describe("mixed public and secured actions", () => {
    it("should correctly differentiate public from secured in server links", async ({
      expect,
    }) => {
      class App {
        getUsers = $action({
          path: "/users",
          schema: { response: t.array(t.text()) },
          handler: () => ["user1", "user2"],
        });
        createUser = $action({
          path: "/users",
          use: [$secure()],
          schema: {
            body: t.object({ name: t.text() }),
            response: t.text(),
          },
          handler: ({ body }) => body.name,
        });
        deleteUser = $action({
          method: "DELETE",
          path: "/users/:id",
          use: [$secure()],
          schema: {
            params: t.object({ id: t.text() }),
            response: t.void(),
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
});
