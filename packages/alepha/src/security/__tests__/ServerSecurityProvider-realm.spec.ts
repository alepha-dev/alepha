import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import {
  $action,
  $route,
  AlephaServer,
  ForbiddenError,
  ServerProvider,
} from "alepha/server";
import { describe, expect, it } from "vitest";

import { $issuer, $secure, AlephaSecurity } from "../index.ts";

describe("$secure issuer protection", () => {
  it("should allow access when user belongs to the required issuer", async () => {
    class TestApp {
      realmA = $issuer({
        secret: "test-realm-a",
        roles: [
          {
            name: "user",
            permissions: [{ name: "*" }],
          },
        ],
      });

      realmB = $issuer({
        secret: "test-realm-b",
        roles: [
          {
            name: "user",
            permissions: [{ name: "*" }],
          },
        ],
      });

      // Action that requires realmA
      actionA = $action({
        use: [$secure({ issuers: ["realmA"] })],
        handler: () => "REALM_A",
      });

      // Route that requires realmB
      routeB = $route({
        method: "GET",
        path: "/realm-b",
        use: [$secure({ issuers: ["realmB"] })],
        handler: () => "REALM_B",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    const userA = {
      id: randomUUID(),
      roles: ["user"],
      realm: "realmA",
      name: "Test User A",
    };

    const userB = {
      id: randomUUID(),
      roles: ["user"],
      realm: "realmB",
      name: "Test User B",
    };

    // User from realmA should access actionA via .run()
    expect(await app.actionA.run({}, { user: userA })).toBe("REALM_A");

    // User from realmA should access actionA via .fetch()
    expect(
      await app.actionA.fetch({}, { user: userA }).then((it) => it.data),
    ).toBe("REALM_A");

    // User from realmB should access routeB via HTTP
    const tokenB = await app.realmB.createToken(userB);
    const responseB = await fetch(
      `${alepha.inject(ServerProvider).hostname}/realm-b`,
      {
        headers: {
          authorization: `Bearer ${tokenB.access_token}`,
        },
      },
    );

    expect(await responseB.text()).toBe("REALM_B");
  });

  it("should deny access when user does not belong to the required issuer", async () => {
    class TestApp {
      realmA = $issuer({
        secret: "test-realm-a",
        roles: [
          {
            name: "user",
            permissions: [{ name: "*" }],
          },
        ],
      });

      realmB = $issuer({
        secret: "test-realm-b",
        roles: [
          {
            name: "user",
            permissions: [{ name: "*" }],
          },
        ],
      });

      // Action that requires realmA
      actionA = $action({
        use: [$secure({ issuers: ["realmA"] })],
        handler: () => "REALM_A",
      });

      // Route that requires realmB
      routeB = $route({
        method: "GET",
        path: "/realm-b",
        use: [$secure({ issuers: ["realmB"] })],
        handler: () => "REALM_B",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    const userA = {
      id: randomUUID(),
      roles: ["user"],
      realm: "realmA",
      name: "Test User A",
    };

    const userB = {
      id: randomUUID(),
      roles: ["user"],
      realm: "realmB",
      name: "Test User B",
    };

    // User from realmB should NOT access actionA via .run()
    await expect(app.actionA.run({}, { user: userB })).rejects.toThrowError(
      ForbiddenError,
    );

    // User from realmB should NOT access actionA via .fetch()
    await expect(app.actionA.fetch({}, { user: userB })).rejects.toThrowError(
      "User must belong to issuer 'realmA' to access this route",
    );

    // User from realmA should NOT access routeB via HTTP (requires realmB)
    const tokenA = await app.realmA.createToken(userA);

    const responseB = await fetch(
      `${alepha.inject(ServerProvider).hostname}/realm-b`,
      {
        headers: {
          authorization: `Bearer ${tokenA.access_token}`,
        },
      },
    );

    expect(responseB.status).toBe(403);
    const errorData = await responseB.json();
    expect(errorData).toEqual({
      error: "ForbiddenError",
      message: "User must belong to issuer 'realmB' to access this route",
      status: 403,
      requestId: expect.any(String),
    });
  });

  it("should work with actions when user has no issuer attribute", async () => {
    class TestApp {
      realmA = $issuer({
        secret: "test-realm-a",
        roles: [
          {
            name: "user",
            permissions: [{ name: "*" }],
          },
        ],
      });

      actionA = $action({
        use: [$secure({ issuers: ["realmA"] })],
        handler: () => "REALM_A",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    const userWithoutRealm = {
      id: randomUUID(),
      roles: ["user"],
      // no realm attribute
    };

    // User without realm attribute should be denied via .run()
    await expect(
      app.actionA.run({}, { user: userWithoutRealm }),
    ).rejects.toThrowError(ForbiddenError);

    // Note: .fetch() in test mode auto-assigns the first realm during token creation,
    // so a user without a realm will succeed if the first realm matches the required realm.
    // This is expected test helper behavior for convenience.
    expect(
      await app.actionA
        .fetch({}, { user: userWithoutRealm })
        .then((it) => it.data),
    ).toBe("REALM_A");
  });

  it("should combine issuer and permission checks", async () => {
    class TestApp {
      realmA = $issuer({
        secret: "test-realm-a",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
          {
            name: "user",
            permissions: [{ name: "read:*" }],
          },
        ],
      });

      realmB = $issuer({
        secret: "test-realm-b",
      });

      // Requires both realmA and admin:manage permission
      adminAction = $action({
        use: [$secure({ issuers: ["realmA"], permissions: ["admin:manage"] })],
        handler: () => "ADMIN",
      });

      // Requires both realmA and read:data permission
      readAction = $action({
        use: [$secure({ issuers: ["realmA"], permissions: ["read:data"] })],
        handler: () => "READ",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    const adminUserRealmA = {
      id: randomUUID(),
      roles: ["admin"],
      realm: "realmA",
      name: "Admin User",
    };

    const regularUserRealmA = {
      id: randomUUID(),
      roles: ["user"],
      realm: "realmA",
      name: "Regular User",
    };

    const adminUserRealmB = {
      id: randomUUID(),
      roles: ["admin"],
      realm: "realmB",
      name: "Admin User B",
    };

    // Admin from realmA should access both actions via .run()
    expect(await app.adminAction.run({}, { user: adminUserRealmA })).toBe(
      "ADMIN",
    );
    expect(await app.readAction.run({}, { user: adminUserRealmA })).toBe(
      "READ",
    );

    // Admin from realmA should access both actions via .fetch()
    expect(
      await app.adminAction
        .fetch({}, { user: adminUserRealmA })
        .then((it) => it.data),
    ).toBe("ADMIN");
    expect(
      await app.readAction
        .fetch({}, { user: adminUserRealmA })
        .then((it) => it.data),
    ).toBe("READ");

    // Regular user from realmA can access readAction (has read:* permission)
    expect(await app.readAction.run({}, { user: regularUserRealmA })).toBe(
      "READ",
    );
    expect(
      await app.readAction
        .fetch({}, { user: regularUserRealmA })
        .then((it) => it.data),
    ).toBe("READ");

    // Regular user from realmA cannot access adminAction (no admin:* permission)
    await expect(
      app.adminAction.run({}, { user: regularUserRealmA }),
    ).rejects.toThrowError(ForbiddenError);

    // Admin from realmB should NOT access any action via .run() (wrong realm)
    await expect(
      app.adminAction.run({}, { user: adminUserRealmB }),
    ).rejects.toThrowError(ForbiddenError);
    await expect(
      app.readAction.run({}, { user: adminUserRealmB }),
    ).rejects.toThrowError(ForbiddenError);

    await expect(
      app.adminAction.fetch({}, { user: adminUserRealmB }),
    ).rejects.toThrowError(
      "User must belong to issuer 'realmA' to access this route",
    );
    await expect(
      app.readAction.fetch({}, { user: adminUserRealmB }),
    ).rejects.toThrowError(
      "User must belong to issuer 'realmA' to access this route",
    );
  });

  it("should work with fetch requests when issuer is valid", async () => {
    class TestApp {
      realmA = $issuer({
        secret: "test-realm-a",
        roles: [
          {
            name: "user",
            permissions: [{ name: "*" }],
          },
        ],
      });

      actionA = $action({
        use: [$secure({ issuers: ["realmA"] })],
        handler: () => "SUCCESS",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    const user = {
      id: randomUUID(),
      roles: ["user"],
      realm: "realmA",
      name: "Test User",
    };

    // Should work via .run()
    expect(await app.actionA.run({}, { user })).toBe("SUCCESS");

    // Should work via .fetch()
    expect(await app.actionA.fetch({}, { user }).then((it) => it.data)).toBe(
      "SUCCESS",
    );

    // Should work via HTTP with token
    const token = await app.realmA.createToken(user);
    const response = await fetch(
      `${alepha.inject(ServerProvider).hostname}${app.actionA.route.path}`,
      {
        headers: {
          authorization: `Bearer ${token.access_token}`,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("SUCCESS");
  });
});
