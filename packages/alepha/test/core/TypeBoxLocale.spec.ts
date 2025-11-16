import { describe, expect, it } from "vitest";
import { Alepha, TypeBoxError, TypeProvider, t } from "../../src/core";

describe("TypeBoxLocale", () => {
  it("should have tests", async () => {
    const boom = async () => {
      Alepha.create().codec.decode(t.number(), "...");
    };

    const error = await boom().catch((err) => err);
    expect(error).toBeInstanceOf(TypeBoxError);
    expect(error.cause.message).toBe("must be number");
    expect(TypeProvider.translateError(error)).toBe("must be number");
    expect(TypeProvider.translateError(error, "fr")).toBe("doit être number");
  });
});
