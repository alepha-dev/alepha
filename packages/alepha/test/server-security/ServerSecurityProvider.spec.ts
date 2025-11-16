import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { $realm } from "alepha/security";
import {
  $action,
  ForbiddenError,
  HttpError,
  ServerProvider,
  UnauthorizedError,
} from "alepha/server";
import { describe, expect, it } from "vitest";
import { AlephaServerSecurity } from "../../src/server-security";

describe("ServerSecurityProvider", () => {
  it("should protect action from unauthorized users", async () => {
    class TestApp {
      ok = $action({
        handler: () => "OK",
      });
    }

    const alepha = Alepha.create().with(AlephaServerSecurity);
    const app = alepha.inject(TestApp);
    await alepha.start();

    // in testing environment, .run() a dummy user is created
    expect(await app.ok.run({})).toBe("OK");

    // but you can force empty user
    await expect(app.ok.run({}, { user: undefined })).rejects.toThrowError(
      UnauthorizedError,
    );

    // .fetch() will also generates a dummy user in testing environment
    expect(await app.ok.fetch({}).then((it) => it.data)).toBe("OK");

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
        group: "read",
        handler: () => "ADMIN",
      });
      user = $action({
        group: "read",
        handler: () => "USER",
      });
      realm = $realm({
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

    const alepha = Alepha.create().with(AlephaServerSecurity);
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
});
