import { Alepha, type Middleware, z } from "alepha";
import { OPTIONS } from "alepha/internal";
import { $rateLimit } from "alepha/rate-limit";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action, $error, ConflictError, NotFoundError } from "alepha/server";
import { describe, it } from "vitest";

import { ServerSwaggerProvider } from "../index.ts";

const QuotaExceeded = $error({
  code: "QuotaExceeded",
  status: 409,
  data: z.object({ limit: z.number(), used: z.number() }),
});

class Api {
  limiter = $rateLimit({ name: "swagger:limit", limit: 10, window: 60_000 });

  strict = $action({
    method: "POST",
    use: [$secure({ roles: ["admin"] }), this.limiter.middleware()],
    errors: [QuotaExceeded, NotFoundError],
    schema: {
      body: z.object({ name: z.text() }),
      response: z.object({ id: z.text() }),
    },
    handler: async () => ({ id: "p1" }),
  });

  sharedStatus = $action({
    method: "GET",
    errors: [QuotaExceeded, ConflictError],
    schema: { response: z.text() },
    handler: async () => "ok",
  });

  nothingExpected = $action({
    method: "GET",
    use: [$secure()],
    errors: [],
    schema: { response: z.text() },
    handler: async () => "ok",
  });

  loose = $action({
    method: "POST",
    use: [$secure({ roles: ["admin"] }), this.limiter.middleware()],
    schema: {
      body: z.object({ name: z.text() }),
      response: z.object({ id: z.text() }),
    },
    handler: async () => ({ id: "p1" }),
  });
}

const generate = () => {
  const alepha = Alepha.create().with(AlephaSecurity).with(Api);
  return alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({});
};

describe("ServerSwaggerProvider - declared errors", () => {
  it("sets MIDDLEWARE_RESPONSES on $secure and $rateLimit", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaSecurity).with(Api);
    const api = alepha.inject(Api);
    const meta = (mw: Middleware) => mw[OPTIONS]?.meta;
    expect(api.strict.middlewares.map((m) => m.meta)).toEqual([
      { protected: "true", responses: "401,403" },
      { responses: "429" },
    ]);
    expect(meta(api.nothingExpected.options.use![0])).toEqual({
      protected: "true",
      responses: "401",
    });
  });

  it("documents a strict action's responses", ({ expect }) => {
    const json = generate();
    const op = json.paths["/api/strict"].post;

    expect(op.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(op.responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "429",
      "500",
    ]);
    expect(op.responses["429"]).toEqual({ description: "Too Many Requests" });
    expect(op.responses["409"]).toEqual({
      description: "Conflict",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/QuotaExceeded" },
        },
      },
    });
    expect(op.responses["404"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/NotFoundError",
    });
    expect(op.responses["500"]).toEqual({
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/InternalServerError" },
        },
      },
    });

    const quota = json.components!.schemas!.QuotaExceeded as any;
    expect(quota.properties.error).toMatchObject({ const: "QuotaExceeded" });
    expect(quota.properties.data).toMatchObject({
      type: "object",
      properties: { limit: { type: "number" }, used: { type: "number" } },
    });
    expect(quota.required).toEqual(
      expect.arrayContaining(["error", "status", "message", "data"]),
    );
    const notFound = json.components!.schemas!.NotFoundError as any;
    expect(notFound.properties.error).toMatchObject({ const: "NotFoundError" });
    expect(notFound.properties.data).toBeUndefined();
  });

  it("renders two errors on one status as oneOf", ({ expect }) => {
    const op = generate().paths["/api/sharedStatus"].get;
    expect(op.responses["409"].content["application/json"].schema).toEqual({
      oneOf: [
        { $ref: "#/components/schemas/QuotaExceeded" },
        { $ref: "#/components/schemas/ConflictError" },
      ],
    });
  });

  it("documents the 500 of errors: []", ({ expect }) => {
    const op = generate().paths["/api/nothingExpected"].get;
    expect(Object.keys(op.responses).sort()).toEqual(["200", "401", "500"]);
  });

  it("leaves an action without errors as it was", ({ expect }) => {
    const op = generate().paths["/api/loose"].post;
    expect(op.responses).toEqual({
      "200": {
        description: "OK",
        content: {
          "application/json": { schema: expect.any(Object) },
        },
      },
      "400": { description: "Bad Request" },
      "401": { description: "Unauthorized" },
    });
  });
});
