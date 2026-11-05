import { Alepha, z } from "alepha";
import { $rateLimit } from "alepha/rate-limit";
import { $secure, AlephaSecurity } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { describe, it } from "vitest";

import { ServerSwaggerProvider } from "../index.ts";

class Api {
  limiter = $rateLimit({ name: "ext:limit", limit: 10, window: 60_000 });

  gated = $action({
    path: "/gated",
    method: "POST",
    group: "admin:orders",
    use: [
      $secure({
        roles: ["admin", "editor"],
        permissions: ["orders:read", { group: "orders", name: "delete" }],
      }),
      this.limiter.middleware(),
    ],
    errors: [NotFoundError],
    timeout: [2, "seconds"],
    schema: {
      body: z.object({ name: z.text() }),
      response: z.object({ id: z.text() }),
    },
    handler: async () => ({ id: "p1" }),
  });

  signedIn = $action({
    path: "/signedIn",
    method: "GET",
    use: [$secure()],
    schema: { response: z.text() },
    handler: async () => "ok",
  });

  open = $action({
    path: "/open",
    method: "GET",
    timeout: false,
    schema: { response: z.text() },
    handler: async () => "ok",
  });
}

const generate = () => {
  const alepha = Alepha.create().with(AlephaSecurity).with(Api);
  return alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({});
};

describe("ServerSwaggerProvider - x-alepha extensions", () => {
  it("names the action and its group", ({ expect }) => {
    const op = generate().paths["/api/gated"].post;
    expect(op["x-alepha-action"]).toEqual({
      name: "gated",
      group: "admin:orders",
    });
  });

  it("lists the middlewares in order", ({ expect }) => {
    const op = generate().paths["/api/gated"].post;
    expect(op["x-alepha-middlewares"]).toEqual(["$secure", "$rateLimit"]);
  });

  it("documents the roles and permissions of a gated action", ({ expect }) => {
    const op = generate().paths["/api/gated"].post;
    expect(op["x-alepha-security"]).toEqual({
      roles: ["admin", "editor"],
      permissions: ["orders:read", "orders:delete"],
    });
  });

  it("documents a sign-in-only gate as an empty security object", ({
    expect,
  }) => {
    const op = generate().paths["/api/signedIn"].get;
    expect(op["x-alepha-security"]).toEqual({});
  });

  it("documents the declared errors and the timeout", ({ expect }) => {
    const op = generate().paths["/api/gated"].post;
    expect(op["x-alepha-errors"]).toEqual(["NOT_FOUND"]);
    expect(op["x-alepha-timeout"]).toBe(2000);
  });

  it("leaves out what an open action has nothing to say about", ({
    expect,
  }) => {
    const op = generate().paths["/api/open"].get;
    expect(op["x-alepha-action"]).toEqual({ name: "open", group: "Api" });
    expect(op["x-alepha-middlewares"]).toBeUndefined();
    expect(op["x-alepha-security"]).toBeUndefined();
    expect(op["x-alepha-errors"]).toBeUndefined();
    expect(op["x-alepha-timeout"]).toBeUndefined();
  });
});
