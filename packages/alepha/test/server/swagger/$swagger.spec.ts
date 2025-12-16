import { Alepha, t } from "alepha";
import { $action } from "alepha/server";
import { $swagger, ServerSwaggerProvider } from "alepha/server/swagger";
import { describe, expect, it } from "vitest";

class App {
  internal = $action({
    hide: true,
    schema: {
      response: t.object({
        message: t.text(),
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
      response: t.object({
        message: t.text(),
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
      response: t.text(),
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
      params: t.object({
        name: t.text(),
      }),
      query: t.object({
        age: t.optional(t.number()),
      }),
      body: t.object({
        name: t.text(),
      }),
      response: t.object(
        {
          message: t.text(),
        },
        {
          title: "HelloResponse",
          description: "Hello response",
        },
      ),
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

describe("$swagger", () => {
  it("should generate OpenAPI spec from actions", () => {
    const swagger = alepha.inject(ServerSwaggerProvider).json;

    expect(swagger).toEqual({
      openapi: "3.0.0",
      info: {
        title: "My API",
        version: "1.0.0",
      },
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
                description: "",
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/HelloResponse",
                    },
                  },
                },
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
                description: "",
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
