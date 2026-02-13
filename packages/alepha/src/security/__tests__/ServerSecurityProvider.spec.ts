import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import {
  $action,
  AlephaServer,
  ForbiddenError,
  HttpError,
  ServerProvider,
  UnauthorizedError,
} from "alepha/server";
import { describe, expect, it } from "vitest";
import { $issuer, $secure, AlephaSecurity } from "../index.ts";

describe("$secure middleware", () => {
  it("should protect action from unauthorized users", async () => {
    class TestApp {
      ok = $action({
        use: [$secure()],
        handler: () => "OK",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    await expect(app.ok.run({})).rejects.toThrowError(UnauthorizedError);
    await expect(app.ok.run({}, { user: undefined })).rejects.toThrowError(
      UnauthorizedError,
    );

    // .fetch() will also generates a dummy user in testing environment
    expect(
      await app.ok
        .fetch(
          {},
          {
            user: {
              id: randomUUID(),
            },
          },
        )
        .then((it) => it.data),
    ).toBe("OK");

    // but you can also force empty user
    await expect(app.ok.fetch({}, { user: undefined })).rejects.toThrowError(
      HttpError,
    );

    // regular fetch does not trigger helpers
    expect(
      await fetch(
        `${alepha.inject(ServerProvider).hostname}${app.ok.route.path}`,
      ).then((it) => it.json()),
    ).toEqual({
      error: "UnauthorizedError",
      message: "Authentication required",
      status: 401,
      requestId: expect.any(String),
    });
  });

  it("should guard by explicit permission", async () => {
    class TestApp {
      admin = $action({
        use: [$secure({ permissions: ["admin:manage"] })],
        handler: () => "ADMIN",
      });
      user = $action({
        use: [$secure({ permissions: ["read:data"] })],
        handler: () => "USER",
      });
      issuer = $issuer({
        secret: "test",
        roles: [
          {
            name: "admin",
            permissions: [{ name: "*" }],
          },
          {
            name: "user",
            permissions: [{ name: "read:data" }],
          },
        ],
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    const user = {
      id: randomUUID(),
      roles: ["user"],
    };
    const admin = {
      id: randomUUID(),
      roles: ["admin"],
    };

    // as user, you can access user action (has read:data permission)
    expect(await app.user.run({}, { user })).toBe("USER");
    expect(await app.user.fetch({}, { user }).then((it) => it.data)).toBe(
      "USER",
    );

    // as admin, you can access user action too (wildcard)
    expect(await app.user.run({}, { user: admin })).toBe("USER");
    expect(
      await app.user.fetch({}, { user: admin }).then((it) => it.data),
    ).toBe("USER");

    // as user, you cannot access admin action (lacks admin:manage)
    await expect(app.admin.run({}, { user })).rejects.toThrowError(
      ForbiddenError,
    );
    await expect(app.admin.fetch({}, { user })).rejects.toThrowError(HttpError);

    // as admin, you can access admin action (wildcard)
    expect(await app.admin.run({}, { user: admin })).toBe("ADMIN");
    expect(
      await app.admin.fetch({}, { user: admin }).then((it) => it.data),
    ).toBe("ADMIN");
  });

  it("should allow auth-only $secure() for any authenticated user", async () => {
    class TestApp {
      action = $action({
        use: [$secure()],
        handler: () => "OK",
      });
      issuer = $issuer({
        secret: "test",
        roles: [
          {
            name: "limited",
            permissions: [], // no permissions at all
          },
        ],
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    // user with "limited" role (no permissions) should still access auth-only action
    const user = { id: randomUUID(), roles: ["limited"] };
    expect(await app.action.run({}, { user })).toBe("OK");
  });

  it("should allow public actions by default (no $secure middleware)", async () => {
    class TestApp {
      public = $action({
        handler: () => "PUBLIC",
      });
      issuer = $issuer({
        secret: "test",
        roles: [{ name: "user", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    // Should work without authentication via .run()
    expect(await app.public.run({})).toBe("PUBLIC");

    // Should work without authentication via .fetch()
    expect(await app.public.fetch({}).then((it) => it.data)).toBe("PUBLIC");

    // Should work via HTTP without token
    const response = await fetch(
      `${alepha.inject(ServerProvider).hostname}${app.public.route.path}`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("PUBLIC");
  });

  it("should require auth when $secure() middleware is present", async () => {
    class TestApp {
      secured = $action({
        use: [$secure()],
        handler: () => "PROTECTED",
      });
      issuer = $issuer({
        secret: "test",
        roles: [{ name: "user", permissions: [{ name: "*" }] }],
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    // Should fail without user
    await expect(app.secured.run({})).rejects.toThrowError(UnauthorizedError);

    // Should succeed with user
    const user = { id: randomUUID(), roles: ["user"] };
    expect(await app.secured.run({}, { user })).toBe("PROTECTED");
  });

  it("should enforce explicit permissions", async () => {
    class TestApp {
      action = $action({
        use: [$secure({ permissions: ["orders:delete"] })],
        handler: () => "DELETED",
      });
      issuer = $issuer({
        secret: "test",
        roles: [
          {
            name: "manager",
            permissions: [{ name: "orders:delete" }],
          },
          {
            name: "viewer",
            permissions: [{ name: "orders:read" }],
          },
        ],
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    const manager = { id: randomUUID(), roles: ["manager"] };
    const viewer = { id: randomUUID(), roles: ["viewer"] };

    // manager can delete
    expect(await app.action.run({}, { user: manager })).toBe("DELETED");

    // viewer cannot delete
    await expect(app.action.run({}, { user: viewer })).rejects.toThrowError(
      ForbiddenError,
    );
  });
});
