import { $pipeline, Alepha } from "alepha";
import {
  ForbiddenError,
  type ServerRequest,
  UnauthorizedError,
} from "alepha/server";
import { describe, test } from "vitest";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import { $secure } from "./$secure.ts";

// -----------------------------------------------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------------------------------------------

const fakeUser: UserAccountToken = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  realm: "default",
  roles: ["admin"],
};

/**
 * Test SecurityProvider that returns a configurable user.
 */
class TestSecurityProvider extends SecurityProvider {
  public nextUser: UserAccountToken | undefined = fakeUser;

  public override async resolveUserFromServerRequest(): Promise<
    UserAccountToken | undefined
  > {
    return this.nextUser;
  }

  public override checkPermission(
    _permissionLike: any,
    ..._roleEntries: string[]
  ) {
    // Simple: "admin" role has all permissions, others don't
    if (_roleEntries.includes("admin")) {
      return { isAuthorized: true, ownership: undefined };
    }
    return { isAuthorized: false, ownership: undefined };
  }
}

// -----------------------------------------------------------------------------------------------------------------
// $secure — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$secure", () => {
  test("allows authenticated request", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    // Simulate request context
    await alepha.context.run(async () => {
      alepha.context.set<ServerRequest>("request", {
        headers: { authorization: "Bearer test-token" },
      } as any);

      expect(await svc.fn()).toBe("ok");
    });
  });

  test("throws UnauthorizedError when no user resolved", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    const security = alepha.inject(TestSecurityProvider);
    security.nextUser = undefined;

    class TestService {
      fn = $pipeline({
        use: [$secure()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.context.set<ServerRequest>("request", {
        headers: {},
      } as any);

      await expect(svc.fn()).rejects.toThrowError(UnauthorizedError);
    });
  });

  test("throws AlephaError when no request context", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    // No context.run → no request
    await expect(svc.fn()).rejects.toThrowError(
      "$secure requires a request context",
    );
  });

  test("sets request.user on success", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure()],
        handler: async () => {
          const req = alepha.context.get<ServerRequest>("request");
          return req?.user;
        },
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.context.set<ServerRequest>("request", {
        headers: { authorization: "Bearer token" },
      } as any);

      const user = await svc.fn();
      expect(user?.id).toBe("user-1");
    });
  });

  test("handler arguments are passed through", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure()],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.context.set<ServerRequest>("request", {
        headers: { authorization: "Bearer token" },
      } as any);

      expect(await svc.fn(3, 4)).toBe(7);
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $secure — permissions
// -----------------------------------------------------------------------------------------------------------------

describe("$secure permissions", () => {
  test("allows when user has required permission", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure({ permissions: ["orders:delete"] })],
        handler: async () => "deleted",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.context.set<ServerRequest>("request", {
        headers: { authorization: "Bearer token" },
      } as any);

      // fakeUser has "admin" role → TestSecurityProvider grants all
      expect(await svc.fn()).toBe("deleted");
    });
  });

  test("throws ForbiddenError when user lacks permission", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    const security = alepha.inject(TestSecurityProvider);
    security.nextUser = {
      ...fakeUser,
      roles: ["viewer"], // Not "admin" → TestSecurityProvider denies
    };

    class TestService {
      fn = $pipeline({
        use: [$secure({ permissions: ["orders:delete"] })],
        handler: async () => "deleted",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.context.set<ServerRequest>("request", {
        headers: { authorization: "Bearer token" },
      } as any);

      await expect(svc.fn()).rejects.toThrowError(ForbiddenError);
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $secure — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$secure metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure({ realm: "admin" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$secure");
  });

  test("metadata without options", ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    expect(svc.fn.middlewares[0].name).toBe("$secure");
  });
});
