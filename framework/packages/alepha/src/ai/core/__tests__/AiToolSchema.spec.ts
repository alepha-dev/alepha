import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { AiConfigError, AiToolSchema } from "../index.ts";

describe("AiToolSchema", () => {
  const schema = Alepha.create().inject(AiToolSchema);

  it("describes the input a tool must send, defaults optional", ({
    expect,
  }) => {
    const json = schema.toJsonSchema(
      z.object({
        status: z.enum(["open", "paid"]).default("open"),
        limit: z.number(),
      }),
    );
    expect(json.$schema).toBeUndefined();
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["limit"]);
    expect(Object.keys(json.properties as object)).toEqual(["status", "limit"]);
  });

  it("accepts vendor-safe names and refuses the rest", ({ expect }) => {
    expect(() => schema.assertName("invoices_list-2")).not.toThrow();
    expect(() => schema.assertName("invoices.list")).toThrow(AiConfigError);
    expect(() => schema.assertName("")).toThrow(AiConfigError);
    expect(() => schema.assertName("a".repeat(65))).toThrow(
      "Invalid AI tool name",
    );
  });
});
