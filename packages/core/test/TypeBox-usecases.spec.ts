import { describe, expect, it } from "vitest";
import { Alepha, t } from "../src";

describe("TypeBox Use Cases", () => {
  it("should remove property when omitted in schema with t.interface()", () => {
    const entity = t.object({
      id: t.int(),
      name: t.string(),
      retryCount: t.optional(t.nullable(t.int())),
    });

    const testPageSchema = t.object({
      content: t.array(t.extend(t.omit(entity, ["retryCount"]), {})),
    });

    const testObject = {
      content: [
        {
          id: 1,
          name: "Test",
          retryCount: null,
        },
      ],
    };

    const alepha = Alepha.create();

    const result = alepha.codec.decode(testPageSchema, testObject);

    expect(result.content[0]).toStrictEqual({
      id: 1,
      name: "Test",
    });
  });
});
