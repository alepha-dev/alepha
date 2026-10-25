import { Alepha, z } from "alepha";
import { DbTimeoutError } from "alepha/orm";
import { $action, serverApiOptions } from "alepha/server";
import { describe, it } from "vitest";

import { ServerSwaggerProvider } from "../index.ts";

class Api {
  own = $action({
    path: "/own",
    method: "POST",
    timeout: [5, "seconds"],
    schema: { response: z.text() },
    handler: async () => "ok",
  });

  none = $action({
    path: "/none",
    method: "POST",
    schema: { response: z.text() },
    handler: async () => "ok",
  });

  optedOut = $action({
    path: "/optedOut",
    method: "POST",
    timeout: false,
    schema: { response: z.text() },
    handler: async () => "ok",
  });

  strict = $action({
    path: "/strict",
    method: "POST",
    timeout: [5, "seconds"],
    errors: [DbTimeoutError],
    schema: { response: z.text() },
    handler: async () => "ok",
  });
}

const generate = (timeout?: number) => {
  const alepha = Alepha.create().with(Api);
  if (timeout !== undefined) {
    alepha.store.mut(serverApiOptions, (o) => ({ ...o, timeout }));
  }
  return alepha.inject(ServerSwaggerProvider).generateSwaggerDoc({});
};

describe("ServerSwaggerProvider - timeout", () => {
  it("documents a 503 TIMEOUT on an action with its own timeout", ({
    expect,
  }) => {
    const doc = generate();
    expect(doc.paths["/api/own"].post.responses["503"]).toEqual({
      description: "Service Unavailable",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/TIMEOUT" },
        },
      },
    });
    expect(doc.components?.schemas?.TIMEOUT.properties.data).toMatchObject({
      properties: { status: {}, timeout: {} },
    });
  });

  it("documents nothing without an effective timeout", ({ expect }) => {
    const doc = generate();
    expect(doc.paths["/api/none"].post.responses["503"]).toBeUndefined();
    expect(doc.paths["/api/optedOut"].post.responses["503"]).toBeUndefined();
  });

  it("documents the serverApiOptions default, except where opted out", ({
    expect,
  }) => {
    const doc = generate(30_000);
    expect(doc.paths["/api/none"].post.responses["503"]).toBeDefined();
    expect(doc.paths["/api/optedOut"].post.responses["503"]).toBeUndefined();
  });

  it("joins a declared 503 as a oneOf", ({ expect }) => {
    const doc = generate();
    const schema =
      doc.paths["/api/strict"].post.responses["503"].content["application/json"]
        .schema;
    expect(schema.oneOf).toEqual([
      { $ref: "#/components/schemas/DB_TIMEOUT" },
      { $ref: "#/components/schemas/TIMEOUT" },
    ]);
  });
});
