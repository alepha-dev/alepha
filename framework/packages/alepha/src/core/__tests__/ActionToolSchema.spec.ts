import { ActionToolSchema, Alepha, AlephaError, z } from "alepha";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

describe("ActionToolSchema", () => {
  class Api {
    update = $action({
      method: "PATCH",
      path: "/invoices/:id",
      description: "Update an invoice",
      schema: {
        params: z.object({ id: z.text() }),
        query: z.object({ notify: z.boolean().default(false) }),
        body: z.object({ amount: z.number() }),
      },
      handler: () => "ok",
    });
    create = $action({
      method: "POST",
      path: "/invoices",
      description: "Create an invoice",
      schema: { body: z.object({ amount: z.number() }) },
      handler: () => "ok",
    });
    undescribed = $action({
      method: "GET",
      path: "/x",
      handler: () => "x",
    });
  }

  const alepha = Alepha.create();
  const api = alepha.inject(Api);
  const schema = alepha.inject(ActionToolSchema);

  it("builds { params, query, body }, query optional, nothing else accepted", ({
    expect,
  }) => {
    expect(schema.fromAction(api.update)).toEqual({
      name: "update",
      description: "Update an invoice",
      parts: ["params", "query", "body"],
      inputSchema: {
        type: "object",
        properties: {
          params: {
            type: "object",
            properties: { id: { type: "string", maxLength: 255 } },
            required: ["id"],
          },
          query: {
            type: "object",
            properties: { notify: { type: "boolean", default: false } },
          },
          body: {
            type: "object",
            properties: { amount: { type: "number" } },
            required: ["amount"],
          },
        },
        required: ["params", "body"],
        additionalProperties: false,
      },
    });
  });

  it("lists only the parts an action declares", ({ expect }) => {
    const tool = schema.fromAction(api.create);
    expect(tool.parts).toEqual(["body"]);
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        body: {
          type: "object",
          properties: { amount: { type: "number" } },
          required: ["amount"],
        },
      },
      required: ["body"],
      additionalProperties: false,
    });
  });

  it("refuses an action with no description, naming it", ({ expect }) => {
    expect(() => schema.fromAction(api.undescribed)).toThrow(AlephaError);
    expect(() => schema.fromAction(api.undescribed)).toThrow(
      "action 'undescribed' has no description",
    );
  });

  it("checks no name: a dotted name passes", ({ expect }) => {
    class Dotted {
      list = $action({
        name: "invoices.list",
        method: "GET",
        path: "/invoices",
        description: "List invoices",
        handler: () => "ok",
      });
    }
    const dotted = Alepha.create().inject(Dotted);
    expect(schema.fromAction(dotted.list).name).toBe("invoices.list");
  });

  it("converts in input mode, without the $schema key", ({ expect }) => {
    const json = schema.toJsonSchema(
      z.object({
        status: z.enum(["open", "paid"]).default("open"),
        limit: z.number(),
      }),
    );
    expect(json.$schema).toBeUndefined();
    expect(json.required).toEqual(["limit"]);
  });
});
