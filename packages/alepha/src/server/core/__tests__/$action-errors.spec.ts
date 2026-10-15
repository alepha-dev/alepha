import { Alepha, AlephaError, SchemaValidationError, z } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { DbTimeoutError } from "alepha/orm";
import { $rateLimit } from "alepha/rate-limit";
import {
  $secure,
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
} from "alepha/security";
import { describe, expectTypeOf, it } from "vitest";

import {
  $action,
  HttpError,
  type HttpErrorClass,
  InternalServerError,
  NotFoundError,
  ServerProvider,
} from "../index.ts";

const QuotaExceeded = HttpError.extend({
  name: "QUOTA_EXCEEDED",
  default: { status: 409 },
  schema: z.object({ limit: z.number() }),
});

class Api {
  limiter = $rateLimit({ name: "strict:limit", limit: 1, window: 60_000 });

  declared = $action({
    method: "POST",
    path: "/declared",
    errors: [QuotaExceeded],
    handler: () => {
      throw new QuotaExceeded({ limit: 5 });
    },
  });

  builtin = $action({
    method: "POST",
    path: "/builtin",
    errors: [NotFoundError],
    handler: () => {
      throw new NotFoundError("No such project");
    },
  });

  undeclared = $action({
    method: "POST",
    path: "/undeclared",
    errors: [QuotaExceeded],
    handler: () => {
      throw new NotFoundError("No such project");
    },
  });

  nothingExpected = $action({
    method: "POST",
    path: "/nothingExpected",
    errors: [],
    handler: () => {
      throw new QuotaExceeded({ limit: 5 });
    },
  });

  strictCrash = $action({
    method: "POST",
    path: "/strictCrash",
    errors: [],
    handler: () => {
      throw new Error("SELECT * FROM secret_table");
    },
  });

  looseCrash = $action({
    method: "POST",
    path: "/looseCrash",
    handler: () => {
      throw new Error("SELECT * FROM secret_table");
    },
  });

  loose = $action({
    method: "POST",
    path: "/loose",
    handler: () => {
      throw new NotFoundError("No such project");
    },
  });

  validated = $action({
    method: "POST",
    path: "/validated",
    errors: [],
    schema: { body: z.object({ n: z.number() }), response: z.text() },
    handler: () => "ok",
  });

  secured = $action({
    method: "POST",
    path: "/secured",
    errors: [],
    use: [$secure()],
    schema: { response: z.text() },
    handler: () => "ok",
  });

  adminOnly = $action({
    method: "POST",
    path: "/adminOnly",
    errors: [],
    use: [$secure({ roles: ["admin"] })],
    schema: { response: z.text() },
    handler: () => "ok",
  });

  limited = $action({
    method: "POST",
    path: "/limited",
    errors: [],
    use: [this.limiter.middleware()],
    schema: { response: z.text() },
    handler: () => "ok",
  });

  timeout = $action({
    method: "POST",
    path: "/timeout",
    errors: [],
    handler: () => {
      // drizzle demotes the driver's error to `cause`
      throw new AlephaError("Failed query: select 1", {
        cause: new DbTimeoutError("Query exceeded 5000ms"),
      });
    },
  });
}

const start = async (env: Record<string, unknown> = {}) => {
  const alepha = Alepha.create({
    env: { SERVER_PORT: 0, APP_SECRET: "test-secret", ...env },
  })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with(AlephaSecurity)
    .with(Api);
  await alepha.start();
  const api = alepha.inject(Api);
  const hostname = alepha.inject(ServerProvider).hostname;
  const call = async (name: string, init?: RequestInit) => {
    const response = await fetch(`${hostname}/api/${name}`, {
      method: "POST",
      ...init,
    });
    return { status: response.status, body: await response.text() };
  };
  const warnings = () =>
    alepha
      .inject(MemoryDestinationProvider)
      .logs.filter((l) => l.level === "WARN")
      .map((l) => l.message);
  return { alepha, api, call, warnings };
};

const caught = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new AlephaError("expected a rejection");
};

describe("$action errors", () => {
  describe("declared errors", () => {
    it("pass through with their status and data, locally and over HTTP", async ({
      expect,
    }) => {
      const { api, call } = await start();

      const local = await caught(() => api.declared());
      expect(local).toBeInstanceOf(QuotaExceeded);

      const http = await call("declared");
      expect(http.status).toBe(409);
      expect(JSON.parse(http.body)).toMatchObject({
        name: "QUOTA_EXCEEDED",
        data: { status: 409, limit: 5 },
      });
    });

    it("accept a built-in class", async ({ expect }) => {
      const { api, call, warnings } = await start();

      expect(await caught(() => api.builtin())).toBeInstanceOf(NotFoundError);
      const http = await call("builtin");
      expect(http.status).toBe(404);
      expect(JSON.parse(http.body)).toMatchObject({
        name: "NOT_FOUND",
        message: "No such project",
      });
      expect(warnings()).toEqual([]);
    });
  });

  describe("undeclared errors", () => {
    it("become an InternalServerError carrying the original", async ({
      expect,
    }) => {
      const { api, call } = await start();

      const local = await caught(() => api.undeclared());
      expect(local).toBeInstanceOf(InternalServerError);
      expect((local as HttpError).status).toBe(500);
      expect((local as Error).cause).toBeInstanceOf(NotFoundError);
      expect((local as Error).message).toBe("NOT_FOUND: No such project");

      const http = await call("undeclared");
      expect(http.status).toBe(500);
      expect(JSON.parse(http.body)).toMatchObject({
        name: "INTERNAL_SERVER_ERROR",
        message: "NOT_FOUND: No such project",
        data: { status: 500 },
      });
    });

    it("warn, naming the action and the undeclared class", async ({
      expect,
    }) => {
      const { api, warnings } = await start();
      await caught(() => api.undeclared());
      expect(warnings()).toEqual([
        expect.stringContaining("'undeclared' threw NOT_FOUND"),
      ]);
    });

    it("answer byte for byte like any other crash in production", async ({
      expect,
    }) => {
      const { call } = await start({
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
      });
      const withoutRequestId = (body: string) =>
        body.replace(/"requestId":"[^"]*"/, '"requestId":"x"');

      const strict = await call("strictCrash");
      const loose = await call("looseCrash");
      expect(strict.status).toBe(500);
      expect(withoutRequestId(strict.body)).toBe(withoutRequestId(loose.body));
      expect(strict.body).not.toContain("secret_table");
    });
  });

  describe("strictness", () => {
    it("treats errors: [] as strict", async ({ expect }) => {
      const { api, call } = await start();
      expect(await caught(() => api.nothingExpected())).toBeInstanceOf(
        InternalServerError,
      );
      expect((await call("nothingExpected")).status).toBe(500);
    });

    it("keeps today's behavior when errors is omitted", async ({ expect }) => {
      const { api, call, warnings } = await start();
      expect(await caught(() => api.loose())).toBeInstanceOf(NotFoundError);
      expect((await call("loose")).status).toBe(404);
      expect(warnings()).toEqual([]);
    });
  });

  describe("framework errors", () => {
    it("pass request validation through as 400", async ({ expect }) => {
      const { api, call } = await start();

      const local = await caught(() =>
        api.validated({ body: { n: "x" as unknown as number } }),
      );
      // A local call encodes the body before validating it, so the codec's
      // own error escapes first; either way it never reaches the filter.
      expect(local).toBeInstanceOf(SchemaValidationError);

      const http = await call("validated", {
        body: JSON.stringify({ n: "x" }),
        headers: { "content-type": "application/json" },
      });
      expect(http.status).toBe(400);
    });

    it("pass $secure's 401 and 403 through", async ({ expect }) => {
      const { alepha, api, call } = await start();

      expect(((await caught(() => api.secured())) as HttpError).status).toBe(
        401,
      );
      expect((await call("secured")).status).toBe(401);

      const realm = alepha.inject(SecurityProvider).getRealms()[0]?.name;
      const jwt = alepha.inject(JwtProvider);
      const token = await jwt.create({ sub: "u1", roles: [] }, realm, {
        header: { typ: jwt.accessTokenTyp },
      });
      const forbidden = await call("adminOnly", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(forbidden.status).toBe(403);
    });

    it("pass $rateLimit's 429 through", async ({ expect }) => {
      const { call } = await start();
      expect((await call("limited")).status).toBe(200);
      expect((await call("limited")).status).toBe(429);
    });

    it("pass a DbTimeoutError through as 503, even wrapped", async ({
      expect,
    }) => {
      const { api, call, warnings } = await start();

      expect(await caught(() => api.timeout())).toBeInstanceOf(DbTimeoutError);
      const http = await call("timeout");
      expect(http.status).toBe(503);
      expect(warnings()).toEqual([]);
    });
  });

  describe("typing", () => {
    it("keeps the declared tuple on the action", () => {
      const api = Alepha.create().with(Api).inject(Api);
      expectTypeOf(api.declared.errors).toEqualTypeOf<
        readonly [typeof QuotaExceeded] | undefined
      >();
      expectTypeOf(api.loose.errors).toEqualTypeOf<undefined>();
      expectTypeOf<typeof QuotaExceeded>().toExtend<HttpErrorClass>();
    });
  });
});
