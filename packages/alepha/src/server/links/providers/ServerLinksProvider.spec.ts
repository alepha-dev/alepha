import { randomUUID } from "node:crypto";
import { Alepha, t } from "alepha";
import { $issuer, AlephaSecurity } from "alepha/security";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import { LinkProvider, ServerLinksProvider } from "../index.ts";

describe("ServerLinksProvider", () => {
  describe("secured field in links", () => {
    it("should set secured=undefined for public actions (no secure option)", async ({
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

    it("should set secured=false for explicitly public actions", async ({
      expect,
    }) => {
      class App {
        publicAction = $action({
          secure: false,
          handler: () => "PUBLIC",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const links = alepha.inject(LinkProvider).getServerLinks();
      const link = links.find((l) => l.name === "publicAction");

      expect(link).toBeDefined();
      expect(link?.secured).toBe(false);
    });

    it("should set secured=true for secured actions", async ({ expect }) => {
      class App {
        securedAction = $action({
          secure: true,
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

    it("should set secured to object for realm-secured actions", async ({
      expect,
    }) => {
      class App {
        realmAction = $action({
          secure: { realm: "admin" },
          handler: () => "REALM",
        });
      }

      const alepha = Alepha.create().with(App).with(ServerLinksProvider);
      await alepha.start();

      const links = alepha.inject(LinkProvider).getServerLinks();
      const link = links.find((l) => l.name === "realmAction");

      expect(link).toBeDefined();
      expect(link?.secured).toEqual({ realm: "admin" });
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
          secure: true,
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
          secure: true,
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
          secure: true,
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

    it("should filter secured actions based on user permissions", async ({
      expect,
    }) => {
      class App {
        adminOnly = $action({
          secure: true,
          group: "admin",
          schema: { response: t.text() },
          handler: () => "ADMIN",
        });
        userAction = $action({
          secure: true,
          group: "user",
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

      // User with "user" role should only see userAction
      const userLinks = await linksProvider.getUserApiLinks({
        user: { id: randomUUID(), roles: ["user"] },
      });

      expect(userLinks.links).toContainEqual(
        expect.objectContaining({ name: "userAction" }),
      );
      expect(userLinks.links).not.toContainEqual(
        expect.objectContaining({ name: "adminOnly" }),
      );

      // User with "admin" role should see both
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
          secure: true,
          schema: {
            body: t.object({ name: t.text() }),
            response: t.text(),
          },
          handler: ({ body }) => body.name,
        });
        deleteUser = $action({
          method: "DELETE",
          path: "/users/:id",
          secure: true,
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

      // getUsers is public (no secure option)
      expect(getUsers?.secured).toBeUndefined();

      // createUser and deleteUser are secured
      expect(createUser?.secured).toBe(true);
      expect(deleteUser?.secured).toBe(true);
    });
  });
});
