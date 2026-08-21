import { Alepha, type Middleware, OPTIONS, z } from "alepha";
import { $action } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $swagger, ServerSwaggerProvider } from "../index.ts";
import type { SwaggerPrimitiveOptions } from "../primitives/$swagger.ts";

// -------------------------------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------------------------------

const fakeSecure = (): Middleware => {
  const mw: Middleware = ((handler: any) => handler) as Middleware;
  mw[OPTIONS] = { name: "$secure" };
  return mw;
};

const doc = (app: Alepha, options: SwaggerPrimitiveOptions = {}) => {
  return app.inject(ServerSwaggerProvider).generateSwaggerDoc(options);
};

// -------------------------------------------------------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------------------------------------------------------

class App {
  internal = $action({
    hide: true,
    schema: {
      response: z.object({
        message: z.text(),
      }),
    },
    handler: async () => {
      return {
        message: "Hello world",
      };
    },
  });

  api = $action({
    hide: true,
    schema: {
      response: z.object({
        message: z.text(),
      }),
    },
    handler: async () => {
      return {
        message: "Hello world",
      };
    },
  });

  text = $action({
    schema: {
      response: z.text(),
    },
    handler: async () => {
      return "Hello world";
    },
  });

  hello = $action({
    path: "/hello/:name",
    name: "hello",
    description: "Hello world",
    group: "app",
    schema: {
      params: z.object({
        name: z.text(),
      }),
      query: z.object({
        age: z.number().optional(),
      }),
      body: z.object({
        name: z.text(),
      }),
      response: z
        .object({
          message: z.text(),
        })
        .meta({ title: "HelloResponse" })
        .describe("Hello response"),
    },
    handler: async (req) => {
      return {
        message: `Hello ${req.body.name}`,
      };
    },
  });

  docs = $swagger({
    info: {
      title: "My API",
      version: "1.0.0",
    },
    ui: false,
  });
}

const alepha = Alepha.create().with(App);

// -------------------------------------------------------------------------------------------------------------------------
// Tests: existing spec (updated for 400 response)
// -------------------------------------------------------------------------------------------------------------------------

describe("$swagger", () => {
  it("should generate OpenAPI spec from actions", () => {
    const swagger = alepha.inject(ServerSwaggerProvider).json;

    expect(swagger).toMatchObject({
      openapi: "3.0.0",
      info: {
        title: "My API",
        version: "1.0.0",
      },
      servers: expect.any(Array),
      paths: {
        "/api/hello/{name}": {
          post: {
            operationId: "hello",
            parameters: [
              {
                in: "query",
                name: "age",
                required: false,
                schema: {
                  type: "number",
                },
              },
              {
                in: "path",
                name: "name",
                required: true,
                schema: {
                  maxLength: 255,
                  type: "string",
                },
              },
            ],
            description: "Hello world",
            tags: ["app"],
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/HelloResponse",
                    },
                  },
                },
              },
              "400": {
                description: "Bad Request",
              },
            },
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    additionalProperties: false,
                    type: "object",
                    properties: {
                      name: {
                        maxLength: 255,
                        type: "string",
                      },
                    },
                    required: ["name"],
                  },
                },
              },
            },
          },
        },
        "/api/text": {
          get: {
            operationId: "text",
            responses: {
              "200": {
                content: {
                  "text/plain": {
                    schema: {
                      maxLength: 255,
                      type: "string",
                    },
                  },
                },
                description: "OK",
              },
            },
            tags: ["App"],
          },
        },
      },
      components: {
        schemas: {
          HelloResponse: {
            additionalProperties: false,
            description: "Hello response",
            properties: {
              message: {
                maxLength: 255,
                type: "string",
              },
            },
            required: ["message"],
            title: "HelloResponse",
            type: "object",
          },
        },
      },
    });
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: security detection
// -------------------------------------------------------------------------------------------------------------------------

describe("security", () => {
  it("should add bearerAuth and 401 for secured actions", () => {
    class SecuredApp {
      secured = $action({
        use: [fakeSecure()],
        schema: {
          response: z.object({ ok: z.boolean() }),
        },
        handler: async () => ({ ok: true }),
      });
    }

    const app = Alepha.create().with(SecuredApp);
    const json = doc(app);
    const op = json.paths["/api/secured"].get;

    expect(op.security).toEqual([{ bearerAuth: [] }]);
    expect(op.responses["401"]).toEqual({ description: "Unauthorized" });
    expect(json.components?.securitySchemes).toEqual({
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Enter a JWT token or API key. Both are accepted as Bearer tokens.",
      },
    });
  });

  it("should not add security for unsecured actions", () => {
    class UnsecuredApp {
      open = $action({
        schema: {
          response: z.object({ ok: z.boolean() }),
        },
        handler: async () => ({ ok: true }),
      });
    }

    const app = Alepha.create().with(UnsecuredApp);
    const json = doc(app);
    const op = json.paths["/api/open"].get;

    expect(op.security).toBeUndefined();
    expect(op.responses["401"]).toBeUndefined();
    expect(json.components?.securitySchemes).toBeUndefined();
  });

  it("should add securitySchemes when at least one action is secured", () => {
    class MixedApp {
      open = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
      secured = $action({
        use: [fakeSecure()],
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(MixedApp);
    const json = doc(app);

    expect(json.paths["/api/open"].get.security).toBeUndefined();
    expect(json.paths["/api/secured"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(json.components?.securitySchemes).toBeDefined();
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: query parameter required
// -------------------------------------------------------------------------------------------------------------------------

describe("query parameters", () => {
  it("should mark required query params as required", () => {
    class QueryApp {
      search = $action({
        schema: {
          query: z.object({
            q: z.text(),
            page: z.number().optional(),
          }),
          response: z.object({ results: z.array(z.text()) }),
        },
        handler: async () => ({ results: [] }),
      });
    }

    const app = Alepha.create().with(QueryApp);
    const json = doc(app);
    const params = json.paths["/api/search"].get.parameters;

    const qParam = params.find((p: any) => p.name === "q");
    const pageParam = params.find((p: any) => p.name === "page");

    expect(qParam.required).toBe(true);
    expect(pageParam.required).toBe(false);
  });

  it("should mark all query params as required when none are optional", () => {
    class StrictQueryApp {
      fetch = $action({
        name: "fetchItems",
        schema: {
          query: z.object({
            id: z.text(),
            type: z.text(),
          }),
          response: z.object({ ok: z.boolean() }),
        },
        handler: async () => ({ ok: true }),
      });
    }

    const app = Alepha.create().with(StrictQueryApp);
    const json = doc(app);
    const params = json.paths["/api/fetchItems"].get.parameters;

    for (const p of params) {
      expect(p.required).toBe(true);
    }
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: error responses (400)
// -------------------------------------------------------------------------------------------------------------------------

describe("error responses", () => {
  it("should add 400 for actions with body", () => {
    class BodyApp {
      create = $action({
        schema: {
          body: z.object({ name: z.text() }),
          response: z.object({ id: z.text() }),
        },
        handler: async () => ({ id: "1" }),
      });
    }

    const app = Alepha.create().with(BodyApp);
    const json = doc(app);
    const op = json.paths["/api/create"].post;

    expect(op.responses["400"]).toEqual({ description: "Bad Request" });
  });

  it("should add 400 for actions with query params", () => {
    class QueryApp {
      search = $action({
        schema: {
          query: z.object({ q: z.text() }),
          response: z.text(),
        },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(QueryApp);
    const json = doc(app);
    const op = json.paths["/api/search"].get;

    expect(op.responses["400"]).toEqual({ description: "Bad Request" });
  });

  it("should add 400 for actions with path params", () => {
    class ParamsApp {
      getById = $action({
        path: "/items/:id",
        schema: {
          params: z.object({ id: z.text() }),
          response: z.object({ name: z.text() }),
        },
        handler: async () => ({ name: "item" }),
      });
    }

    const app = Alepha.create().with(ParamsApp);
    const json = doc(app);
    const op = json.paths["/api/items/{id}"].get;

    expect(op.responses["400"]).toEqual({ description: "Bad Request" });
  });

  it("should not add 400 for actions without validation", () => {
    class NoValidationApp {
      ping = $action({
        schema: {
          response: z.text(),
        },
        handler: async () => "pong",
      });
    }

    const app = Alepha.create().with(NoValidationApp);
    const json = doc(app);
    const op = json.paths["/api/ping"].get;

    expect(op.responses["400"]).toBeUndefined();
  });

  it("should add both 400 and 401 for secured actions with body", () => {
    class SecuredBodyApp {
      create = $action({
        use: [fakeSecure()],
        schema: {
          body: z.object({ name: z.text() }),
          response: z.object({ id: z.text() }),
        },
        handler: async () => ({ id: "1" }),
      });
    }

    const app = Alepha.create().with(SecuredBodyApp);
    const json = doc(app);
    const op = json.paths["/api/create"].post;

    expect(op.responses["400"]).toEqual({ description: "Bad Request" });
    expect(op.responses["401"]).toEqual({ description: "Unauthorized" });
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: response types
// -------------------------------------------------------------------------------------------------------------------------

describe("response types", () => {
  it("should handle object response as application/json", () => {
    class ObjApp {
      get = $action({
        name: "getObj",
        schema: { response: z.object({ a: z.text() }) },
        handler: async () => ({ a: "b" }),
      });
    }

    const app = Alepha.create().with(ObjApp);
    const json = doc(app);
    const content = json.paths["/api/getObj"].get.responses["200"].content;

    expect(content["application/json"]).toBeDefined();
  });

  it("should handle array response as application/json", () => {
    class ArrayApp {
      list = $action({
        schema: { response: z.array(z.text()) },
        handler: async () => ["a"],
      });
    }

    const app = Alepha.create().with(ArrayApp);
    const json = doc(app);
    const content = json.paths["/api/list"].get.responses["200"].content;

    expect(content["application/json"]).toBeDefined();
  });

  it("should handle string response as text/plain", () => {
    class StrApp {
      getText = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(StrApp);
    const json = doc(app);
    const content = json.paths["/api/getText"].get.responses["200"].content;

    expect(content["text/plain"]).toBeDefined();
  });

  it("should handle number response as application/json", () => {
    class NumApp {
      count = $action({
        schema: { response: z.number() as any },
        handler: async () => 42 as any,
      });
    }

    const app = Alepha.create().with(NumApp);
    const json = doc(app);
    const resp = json.paths["/api/count"].get.responses["200"];

    expect(resp.content["application/json"]).toBeDefined();
    expect(resp.content["application/json"].schema.type).toBe("number");
  });

  it("should handle integer response as application/json", () => {
    class IntApp {
      countInt = $action({
        schema: { response: z.integer() as any },
        handler: async () => 42 as any,
      });
    }

    const app = Alepha.create().with(IntApp);
    const json = doc(app);
    const resp = json.paths["/api/countInt"].get.responses["200"];

    expect(resp.content["application/json"]).toBeDefined();
    expect(resp.content["application/json"].schema.type).toBe("integer");
  });

  it("should handle boolean response as application/json", () => {
    class BoolApp {
      check = $action({
        schema: { response: z.boolean() as any },
        handler: async () => true as any,
      });
    }

    const app = Alepha.create().with(BoolApp);
    const json = doc(app);
    const resp = json.paths["/api/check"].get.responses["200"];

    expect(resp.content["application/json"]).toBeDefined();
    expect(resp.content["application/json"].schema.type).toBe("boolean");
  });

  it("should handle file response as application/octet-stream", () => {
    class FileApp {
      download = $action({
        schema: { response: z.file() as any },
        handler: async () => new Blob([]) as any,
      });
    }

    const app = Alepha.create().with(FileApp);
    const json = doc(app);
    const content = json.paths["/api/download"].get.responses["200"].content;

    expect(content["application/octet-stream"]).toBeDefined();
  });

  it("should return 204 for actions without response schema", () => {
    class NoResponseApp {
      fire = $action({
        schema: {},
        handler: async () => {},
      });
    }

    const app = Alepha.create().with(NoResponseApp);
    const json = doc(app);
    const responses = json.paths["/api/fire"].get.responses;

    expect(responses["204"]).toBeDefined();
    expect(responses["204"].content).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: hide and excludeTags
// -------------------------------------------------------------------------------------------------------------------------

describe("hide and excludeTags", () => {
  it("should exclude actions with hide: true", () => {
    class HideApp {
      visible = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
      hidden = $action({
        hide: true,
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(HideApp);
    const json = doc(app);

    expect(json.paths["/api/visible"]).toBeDefined();
    expect(json.paths["/api/hidden"]).toBeUndefined();
  });

  it("should exclude actions matching excludeTags", () => {
    class TagApp {
      pub = $action({
        group: "public",
        schema: { response: z.text() },
        handler: async () => "ok",
      });
      internal = $action({
        group: "internal",
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(TagApp);
    const json = doc(app, { excludeTags: ["internal"] });

    expect(json.paths["/api/pub"]).toBeDefined();
    expect(json.paths["/api/internal"]).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: rewrite
// -------------------------------------------------------------------------------------------------------------------------

describe("rewrite", () => {
  it("should allow rewriting the OpenAPI document", () => {
    class RewriteApp {
      hello = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(RewriteApp);
    const json = doc(app, {
      rewrite: (d) => {
        d.info.title = "Rewritten Title";
        d.info.description = "Added by rewrite";
      },
    });

    expect(json.info.title).toBe("Rewritten Title");
    expect(json.info.description).toBe("Added by rewrite");
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: multipart
// -------------------------------------------------------------------------------------------------------------------------

describe("multipart", () => {
  it("should detect file upload as multipart/form-data", () => {
    class UploadApp {
      upload = $action({
        schema: {
          body: z.object({
            file: z.file(),
            name: z.text(),
          }),
          response: z.object({ ok: z.boolean() }),
        },
        handler: async () => ({ ok: true }),
      });
    }

    const app = Alepha.create().with(UploadApp);
    const json = doc(app);
    const body = json.paths["/api/upload"].post.requestBody;

    expect(body.content["multipart/form-data"]).toBeDefined();
    expect(body.content["application/json"]).toBeUndefined();
  });

  it("should use application/json for body without files", () => {
    class JsonBodyApp {
      create = $action({
        schema: {
          body: z.object({ name: z.text() }),
          response: z.object({ ok: z.boolean() }),
        },
        handler: async () => ({ ok: true }),
      });
    }

    const app = Alepha.create().with(JsonBodyApp);
    const json = doc(app);
    const body = json.paths["/api/create"].post.requestBody;

    expect(body.content["application/json"]).toBeDefined();
    expect(body.content["multipart/form-data"]).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: array body
// -------------------------------------------------------------------------------------------------------------------------

describe("array body", () => {
  it("should handle array request body", () => {
    class ArrayBodyApp {
      batch = $action({
        schema: {
          body: z.array(z.object({ id: z.text() })),
          response: z.object({ count: z.number() }),
        },
        handler: async () => ({ count: 0 }),
      });
    }

    const app = Alepha.create().with(ArrayBodyApp);
    const json = doc(app);
    const body = json.paths["/api/batch"].post.requestBody;

    expect(body.content["application/json"]).toBeDefined();
    expect(body.content["application/json"].schema.type).toBe("array");
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: $ref schemas
// -------------------------------------------------------------------------------------------------------------------------

describe("$ref schemas", () => {
  it("should extract titled schemas into components/schemas", () => {
    class RefApp {
      getItem = $action({
        schema: {
          response: z.object({ id: z.text() }).meta({ title: "ItemResponse" }),
        },
        handler: async () => ({ id: "1" }),
      });
    }

    const app = Alepha.create().with(RefApp);
    const json = doc(app);

    const resp =
      json.paths["/api/getItem"].get.responses["200"].content[
        "application/json"
      ].schema;
    expect(resp).toEqual({ $ref: "#/components/schemas/ItemResponse" });
    expect(json.components?.schemas?.ItemResponse).toBeDefined();
    expect(json.components?.schemas?.ItemResponse.type).toBe("object");
  });

  it("should inline untitled schemas", () => {
    class InlineApp {
      getInline = $action({
        schema: {
          response: z.object({ id: z.text() }),
        },
        handler: async () => ({ id: "1" }),
      });
    }

    const app = Alepha.create().with(InlineApp);
    const json = doc(app);

    const resp =
      json.paths["/api/getInline"].get.responses["200"].content[
        "application/json"
      ].schema;
    expect(resp.type).toBe("object");
    expect(resp.$ref).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: path params
// -------------------------------------------------------------------------------------------------------------------------

describe("path params", () => {
  it("should convert :param to {param}", () => {
    const swagger = alepha.inject(ServerSwaggerProvider);
    expect(swagger.replacePathParams("/users/:id")).toBe("/users/{id}");
    expect(swagger.replacePathParams("/users/:id/posts/:postId")).toBe(
      "/users/{id}/posts/{postId}",
    );
    expect(swagger.replacePathParams("/static")).toBe("/static");
  });

  it("should extract param description from schema", () => {
    class ParamDescApp {
      getItem = $action({
        path: "/items/:id",
        schema: {
          params: z.object({
            id: z.text({ description: "The item identifier" }),
          }),
          response: z.text(),
        },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(ParamDescApp);
    const json = doc(app);
    const param = json.paths["/api/items/{id}"].get.parameters[0];

    expect(param.description).toBe("The item identifier");
    expect(param.schema.description).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: removePrivateFields
// -------------------------------------------------------------------------------------------------------------------------

describe("removePrivateFields", () => {
  it("should remove excluded keys from nested objects", () => {
    const swagger = alepha.inject(ServerSwaggerProvider);
    const obj = {
      a: 1,
      "~options": { x: 1 },
      nested: {
        b: 2,
        "~options": { y: 2 },
        deep: {
          c: 3,
          secret: "hidden",
        },
      },
    };

    swagger.removePrivateFields(obj, ["~options", "secret"]);

    expect(obj).toEqual({
      a: 1,
      nested: {
        b: 2,
        deep: {
          c: 3,
        },
      },
    });
  });

  it("should handle arrays", () => {
    const swagger = alepha.inject(ServerSwaggerProvider);
    const obj = {
      items: [
        { id: 1, "~options": true },
        { id: 2, "~options": false },
      ],
    };

    swagger.removePrivateFields(obj, ["~options"]);

    expect(obj).toEqual({
      items: [{ id: 1 }, { id: 2 }],
    });
  });

  it("should handle circular references without infinite loop", () => {
    const swagger = alepha.inject(ServerSwaggerProvider);
    const obj: any = { a: 1 };
    obj.self = obj;

    swagger.removePrivateFields(obj, ["a"]);

    expect(obj.a).toBeUndefined();
    expect(obj.self).toBe(obj);
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: isBodyMultipart
// -------------------------------------------------------------------------------------------------------------------------

describe("multipart request bodies", () => {
  class UploadApp {
    buffered = $action({
      method: "POST",
      path: "/buffered",
      schema: {
        body: z.object({ file: z.file(), name: z.text() }),
        response: z.text(),
      },
      handler: async () => "ok",
    });

    // The framework's own upload endpoint takes its bytes in flight. Documented
    // as JSON, every client generated from this spec sends the wrong
    // content-type — and the endpoint that broke this way was `POST /api/files`.
    streamed = $action({
      method: "POST",
      path: "/streamed",
      schema: {
        body: z.object({ file: z.stream() }),
        response: z.text(),
      },
      handler: async () => "ok",
    });

    plain = $action({
      method: "POST",
      path: "/plain",
      schema: {
        body: z.object({ name: z.text() }),
        response: z.text(),
      },
      handler: async () => "ok",
    });
  }

  const uploads = () => doc(Alepha.create().with(UploadApp)) as any;

  it("documents a z.file() body as multipart/form-data", () => {
    const content = uploads().paths["/api/buffered"].post.requestBody.content;

    expect(Object.keys(content)).toEqual(["multipart/form-data"]);
  });

  it("documents a z.stream() body as multipart/form-data", () => {
    const content = uploads().paths["/api/streamed"].post.requestBody.content;

    expect(Object.keys(content)).toEqual(["multipart/form-data"]);
  });

  it("documents a body with no bytes as JSON", () => {
    const content = uploads().paths["/api/plain"].post.requestBody.content;

    expect(Object.keys(content)).toEqual(["application/json"]);
  });

  it("describes both kinds of byte field as a binary string", () => {
    // `format: "stream"` is Alepha's word for how the bytes reach the handler.
    // OpenAPI has no such format, and a reader — Swagger UI, a generator — that
    // does not recognise it renders no file picker at all.
    const streamed =
      uploads().paths["/api/streamed"].post.requestBody.content[
        "multipart/form-data"
      ].schema.properties.file;
    const buffered =
      uploads().paths["/api/buffered"].post.requestBody.content[
        "multipart/form-data"
      ].schema.properties.file;

    expect(buffered).toMatchObject({ type: "string", format: "binary" });
    expect(streamed).toMatchObject({ type: "string", format: "binary" });
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: disabled
// -------------------------------------------------------------------------------------------------------------------------

describe("disabled", () => {
  it("should not generate spec when disabled", () => {
    class DisabledApp {
      hello = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
      docs = $swagger({ disabled: true, ui: false });
    }

    const app = Alepha.create().with(DisabledApp);
    const json = app.inject(ServerSwaggerProvider).json;

    expect(json).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: default info
// -------------------------------------------------------------------------------------------------------------------------

describe("default info", () => {
  it("should use default info when not provided", () => {
    class DefaultApp {
      hello = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(DefaultApp);
    const json = doc(app);

    expect(json.info).toEqual({
      title: "API Documentation",
      version: "1.0.0",
    });
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: tags
// -------------------------------------------------------------------------------------------------------------------------

describe("tags", () => {
  it("should format colon-separated groups as slash-separated tags", () => {
    class TagApp {
      hello = $action({
        group: "admin:users",
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(TagApp);
    const json = doc(app);
    const op = json.paths["/api/hello"].get;

    expect(op.tags).toEqual(["admin / users"]);
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: summary and description
// -------------------------------------------------------------------------------------------------------------------------

describe("summary and description", () => {
  it("should include summary and description in operation", () => {
    class SummaryApp {
      hello = $action({
        summary: "Say hello",
        description: "Returns a greeting",
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(SummaryApp);
    const json = doc(app);
    const op = json.paths["/api/hello"].get;

    expect(op.summary).toBe("Say hello");
    expect(op.description).toBe("Returns a greeting");
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: actions without schema are skipped
// -------------------------------------------------------------------------------------------------------------------------

describe("actions without schema", () => {
  it("should skip actions without schema", () => {
    class NoSchemaApp {
      hello = $action({
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(NoSchemaApp);
    const json = doc(app);

    expect(Object.keys(json.paths)).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: deprecated
// -------------------------------------------------------------------------------------------------------------------------

describe("deprecated", () => {
  it("should mark action as deprecated when flag is set", () => {
    class DeprecatedApp {
      old = $action({
        deprecated: true,
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(DeprecatedApp);
    const json = doc(app);
    const op = json.paths["/api/old"].get;

    expect(op.deprecated).toBe(true);
  });

  it("should not include deprecated field when not set", () => {
    class NormalApp {
      current = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(NormalApp);
    const json = doc(app);
    const op = json.paths["/api/current"].get;

    expect(op.deprecated).toBeUndefined();
  });

  it("should not include deprecated field when explicitly false", () => {
    class NotDeprecatedApp {
      active = $action({
        deprecated: false,
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(NotDeprecatedApp);
    const json = doc(app);
    const op = json.paths["/api/active"].get;

    expect(op.deprecated).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: servers
// -------------------------------------------------------------------------------------------------------------------------

describe("servers", () => {
  it("should auto-populate servers from hostname", () => {
    class ServerApp {
      hello = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(ServerApp);
    const json = doc(app);

    expect(json.servers).toBeDefined();
    expect(json.servers).toHaveLength(1);
    expect(json.servers![0].url).toBeDefined();
  });

  it("should use custom servers when provided", () => {
    class CustomServerApp {
      hello = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(CustomServerApp);
    const json = doc(app, {
      servers: [
        { url: "https://api.example.com", description: "Production" },
        { url: "https://staging.example.com", description: "Staging" },
      ],
    });

    expect(json.servers).toEqual([
      { url: "https://api.example.com", description: "Production" },
      { url: "https://staging.example.com", description: "Staging" },
    ]);
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: response descriptions
// -------------------------------------------------------------------------------------------------------------------------

describe("response descriptions", () => {
  it("should use 'OK' for 200 responses", () => {
    class OkApp {
      hello = $action({
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(OkApp);
    const json = doc(app);

    expect(json.paths["/api/hello"].get.responses["200"].description).toBe(
      "OK",
    );
  });

  it("should use 'No Content' for 204 responses", () => {
    class NoContentApp {
      fire = $action({
        schema: {},
        handler: async () => {},
      });
    }

    const app = Alepha.create().with(NoContentApp);
    const json = doc(app);

    expect(json.paths["/api/fire"].get.responses["204"].description).toBe(
      "No Content",
    );
  });

  it("should use 'Created' for 201 responses", () => {
    class CreatedApp {
      create = $action({
        schema: {
          body: z.object({ name: z.text() }),
          response: { 201: z.object({ id: z.text() }) } as any,
        },
        handler: async () => ({ id: "1" }) as any,
      });
    }

    const app = Alepha.create().with(CreatedApp);
    const json = doc(app);

    expect(json.paths["/api/create"].post.responses["201"].description).toBe(
      "Created",
    );
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: security scheme description (API key)
// -------------------------------------------------------------------------------------------------------------------------

describe("security scheme description", () => {
  it("should include description about JWT and API key in bearerAuth", () => {
    class AuthApp {
      secured = $action({
        use: [fakeSecure()],
        schema: { response: z.text() },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(AuthApp);
    const json = doc(app);

    expect(json.components?.securitySchemes?.bearerAuth.description).toBe(
      "Enter a JWT token or API key. Both are accepted as Bearer tokens.",
    );
  });
});

// -------------------------------------------------------------------------------------------------------------------------
// Tests: examples
// -------------------------------------------------------------------------------------------------------------------------

describe("examples", () => {
  it("should extract examples from query param schema", () => {
    class ExampleQueryApp {
      search = $action({
        schema: {
          query: z.object({
            q: z.text({ examples: ["hello world"] }),
          }),
          response: z.text(),
        },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(ExampleQueryApp);
    const json = doc(app);
    const param = json.paths["/api/search"].get.parameters[0];

    expect(param.example).toBe("hello world");
  });

  it("should extract default as example from query param schema", () => {
    class DefaultQueryApp {
      search = $action({
        schema: {
          query: z.object({
            page: z.number().default(1),
          }),
          response: z.text(),
        },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(DefaultQueryApp);
    const json = doc(app);
    const param = json.paths["/api/search"].get.parameters[0];

    expect(param.example).toBe(1);
  });

  it("should extract examples from path param schema", () => {
    class ExampleParamApp {
      getUser = $action({
        path: "/users/:id",
        schema: {
          params: z.object({
            id: z.text({ examples: ["usr_abc123"] }),
          }),
          response: z.text(),
        },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(ExampleParamApp);
    const json = doc(app);
    const param = json.paths["/api/users/{id}"].get.parameters[0];

    expect(param.example).toBe("usr_abc123");
  });

  it("should not add example when none exists", () => {
    class NoExampleApp {
      search = $action({
        schema: {
          query: z.object({
            q: z.text(),
          }),
          response: z.text(),
        },
        handler: async () => "ok",
      });
    }

    const app = Alepha.create().with(NoExampleApp);
    const json = doc(app);
    const param = json.paths["/api/search"].get.parameters[0];

    expect(param.example).toBeUndefined();
  });
});
