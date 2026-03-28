import { $pipeline, Alepha } from "alepha";
import { ForbiddenError, UnauthorizedError } from "alepha/server";
import { describe, test } from "vitest";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { $secure } from "../primitives/$secure.ts";
import { SecurityProvider } from "../providers/SecurityProvider.ts";

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
      alepha.set("alepha.http.request", {
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
      alepha.set("alepha.http.request", {
        headers: {},
      } as any);

      await expect(svc.fn()).rejects.toThrowError(UnauthorizedError);
    });
  });

  test("throws UnauthorizedError when no request context and no atom", async ({
    expect,
  }) => {
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

    // No context.run → no request and no atom → unauthorized
    await expect(svc.fn()).rejects.toThrowError(UnauthorizedError);
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
          const req = alepha.store.get("alepha.http.request");
          return req?.user;
        },
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
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
      alepha.set("alepha.http.request", {
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
      alepha.set("alepha.http.request", {
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
      alepha.set("alepha.http.request", {
        headers: { authorization: "Bearer token" },
      } as any);

      await expect(svc.fn()).rejects.toThrowError(ForbiddenError);
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $secure — roles
// -----------------------------------------------------------------------------------------------------------------

describe("$secure roles", () => {
  test("allows when user has required role", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure({ roles: ["admin"] })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        headers: { authorization: "Bearer token" },
      } as any);

      expect(await svc.fn()).toBe("ok");
    });
  });

  test("throws ForbiddenError when user lacks required role", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure({ roles: ["superadmin"] })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        headers: { authorization: "Bearer token" },
      } as any);

      // fakeUser has "admin" role, not "superadmin"
      await expect(svc.fn()).rejects.toThrowError(ForbiddenError);
    });
  });

  test("allows when user has one of multiple required roles", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure({ roles: ["superadmin", "admin"] })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        headers: { authorization: "Bearer token" },
      } as any);

      // fakeUser has "admin" role → matches one of the required roles
      expect(await svc.fn()).toBe("ok");
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $secure — guard
// -----------------------------------------------------------------------------------------------------------------

describe("$secure guard", () => {
  test("allows when guard returns true", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure({ guard: (user) => user.id === "user-1" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        headers: { authorization: "Bearer token" },
      } as any);

      expect(await svc.fn()).toBe("ok");
    });
  });

  test("throws ForbiddenError when guard returns false", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure({ guard: (user) => user.id === "someone-else" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
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
        use: [$secure({ issuers: ["admin"] })],
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

  test("permissions are stored in metadata", ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: SecurityProvider,
      use: TestSecurityProvider,
    });

    class TestService {
      fn = $pipeline({
        use: [$secure({ permissions: ["orders:delete"] })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares[0];
    expect(meta.name).toBe("$secure");
    expect(meta.options?.permissions).toEqual(["orders:delete"]);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $secure — atom resolution
// -----------------------------------------------------------------------------------------------------------------

describe("$secure atom resolution", () => {
  test("reads user from currentUserAtom when set", async ({ expect }) => {
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

    // Set user via atom (no request context needed)
    await alepha.context.run(async () => {
      alepha.store.set(currentUserAtom, fakeUser);
      expect(await svc.fn()).toBe("ok");
    });
  });

  test("atom user is checked for permissions", async ({ expect }) => {
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

    // Set user with "viewer" role via atom → should be denied
    await alepha.context.run(async () => {
      alepha.store.set(currentUserAtom, { ...fakeUser, roles: ["viewer"] });
      await expect(svc.fn()).rejects.toThrowError(ForbiddenError);
    });
  });
});
