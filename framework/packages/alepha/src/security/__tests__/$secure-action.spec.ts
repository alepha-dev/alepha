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
import { describe, it } from "vitest";

import { $issuer, $secure, AlephaSecurity } from "../index.ts";

describe("$secure middleware", () => {
  it("should protect action from unauthorized users", async ({ expect }) => {
    class TestApp {
      ok = $action({
        path: "/ok",
        method: "GET",
        use: [$secure()],
        handler: () => "OK",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(AlephaSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    await expect(app.ok.run({})).rejects.toThrow(UnauthorizedError);
    await expect(app.ok.run({}, { user: undefined })).rejects.toThrow(
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
    await expect(app.ok.fetch({}, { user: undefined })).rejects.toThrow(
      HttpError,
    );

    // regular fetch does not trigger helpers
    expect(
      await fetch(
        `${alepha.inject(ServerProvider).hostname}${app.ok.route.path}`,
      ).then((it) => it.json()),
    ).toEqual({
      name: "UNAUTHORIZED",
      message: "Authentication required",
      data: { status: 401, requestId: expect.any(String) },
    });
  });

  it("should guard by explicit permission", async ({ expect }) => {
    class TestApp {
      admin = $action({
        path: "/admin",
        method: "GET",
        use: [$secure({ permissions: ["admin:manage"] })],
        handler: () => "ADMIN",
      });
      user = $action({
        path: "/user",
        method: "GET",
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
    await expect(app.admin.run({}, { user })).rejects.toThrow(ForbiddenError);
    await expect(app.admin.fetch({}, { user })).rejects.toThrow(HttpError);

    // as admin, you can access admin action (wildcard)
    expect(await app.admin.run({}, { user: admin })).toBe("ADMIN");
    expect(
      await app.admin.fetch({}, { user: admin }).then((it) => it.data),
    ).toBe("ADMIN");
  });

  it("should allow auth-only $secure() for any authenticated user", async ({
    expect,
  }) => {
    class TestApp {
      action = $action({
        path: "/action",
        method: "GET",
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

  it("should allow public actions by default (no $secure middleware)", async ({
    expect,
  }) => {
    class TestApp {
      public = $action({
        path: "/public",
        method: "GET",
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
});
