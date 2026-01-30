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
import { $issuer, AlephaSecurity } from "../index.ts";

describe("ServerSecurityProvider", () => {
  it("should protect action from unauthorized users", async () => {
    class TestApp {
      ok = $action({
        secure: true,
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
      message: "Invalid authorization header, maybe token is missing ?",
      status: 401,
      requestId: expect.any(String),
    });
  });

  it("should guard by permission", async () => {
    class TestApp {
      admin = $action({
        secure: true,
        group: "read",
        handler: () => "ADMIN",
      });
      user = $action({
        secure: true,
        group: "read",
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
            permissions: [{ name: "read:user" }],
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

    // as user, you can access user action
    expect(await app.user.run({}, { user })).toBe("USER");
    expect(await app.user.fetch({}, { user }).then((it) => it.data)).toBe(
      "USER",
    );

    // as admin, you can access user action too
    expect(await app.user.run({}, { user: admin })).toBe("USER");
    expect(
      await app.user.fetch({}, { user: admin }).then((it) => it.data),
    ).toBe("USER");

    // as user, you cannot access admin action
    await expect(app.admin.run({}, { user })).rejects.toThrowError(
      ForbiddenError,
    );
    await expect(app.admin.fetch({}, { user })).rejects.toThrowError(
      new HttpError({
        status: 403,
        message: "User is not allowed to access 'read:admin'",
        requestId: expect.any(String),
      }),
    );

    // as admin, you can access admin action
    expect(await app.admin.run({}, { user: admin })).toBe("ADMIN");
    expect(
      await app.admin.fetch({}, { user: admin }).then((it) => it.data),
    ).toBe("ADMIN");
  });

  it("should allow public actions by default (no secure option)", async () => {
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

  it("should allow explicit secure: false", async () => {
    class TestApp {
      public = $action({
        secure: false,
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

    // Should work without authentication
    expect(await app.public.run({})).toBe("PUBLIC");
    expect(await app.public.fetch({}).then((it) => it.data)).toBe("PUBLIC");
  });

  it("should require auth when secure: true is explicit", async () => {
    class TestApp {
      protected = $action({
        secure: true,
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
    await expect(app.protected.run({})).rejects.toThrowError(UnauthorizedError);

    // Should succeed with user
    const user = { id: randomUUID(), roles: ["user"] };
    expect(await app.protected.run({}, { user })).toBe("PROTECTED");
  });
});
