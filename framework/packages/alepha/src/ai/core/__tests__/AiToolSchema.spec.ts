import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AiConfigError, AiToolSchema } from "../index.ts";

describe("AiToolSchema", () => {
  const schema = Alepha.create().inject(AiToolSchema);

  it("accepts vendor-safe names and refuses the rest", ({ expect }) => {
    expect(() => schema.assertName("invoices_list-2")).not.toThrow();
    expect(() => schema.assertName("invoices.list")).toThrow(AiConfigError);
    expect(() => schema.assertName("")).toThrow(AiConfigError);
    expect(() => schema.assertName("a".repeat(65))).toThrow(
      "Invalid AI tool name",
    );
  });
});
