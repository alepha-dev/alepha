import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

describe("Zod use cases", () => {
  it("should drop a property omitted from the schema when decoding", () => {
    const entity = z.object({
      id: z.integer(),
      name: z.string(),
      retryCount: z.integer().nullable().optional(),
    });

    const testPageSchema = z.object({
      content: z.array(entity.omit({ retryCount: true }).extend({})),
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
