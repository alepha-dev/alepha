import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $tool } from "../primitives/$tool.ts";

describe("$tool descriptor", () => {
  it("describes params by what the caller sends, not what the handler receives", async () => {
    const alepha = Alepha.create();

    class Tools {
      search = $tool({
        description: "search",
        schema: {
          params: z.object({
            query: z.string(),
            limit: z.number().default(10),
            tags: z.string().transform((value) => value.split(",")),
          }),
        },
        handler: async () => "ok",
      });
    }

    const tools = alepha.inject(Tools);
    await alepha.start();

    const input = tools.search.toDescriptor().inputSchema as any;

    // A defaulted field is optional on the way in; the output mode used to
    // list it as required and drop the default, so a client calling without
    // `limit` was refused by its own validation.
    expect(input.required).toEqual(["query", "tags"]);
    expect(input.properties.limit).toMatchObject({
      type: "number",
      default: 10,
    });
    // A transform is described by its input type (a string), not by the
    // array the handler ends up with.
    expect(input.properties.tags).toMatchObject({ type: "string" });
    expect(input.$schema).toBe("https://json-schema.org/draft/2020-12/schema");

    await alepha.stop();
  });

  it("refuses two tools registered under one name", () => {
    const alepha = Alepha.create();

    class First {
      ping = $tool({ description: "first", handler: async () => "1" });
    }
    class Second {
      ping = $tool({ description: "second", handler: async () => "2" });
    }

    alepha.inject(First);
    // A silent overwrite used to make the first tool vanish from the list.
    expect(() => alepha.inject(Second)).toThrow(/'ping' is registered twice/);
  });
});
