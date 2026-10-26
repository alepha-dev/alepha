import { describe, it } from "vitest";

import { AiContextBlock } from "../index.ts";

describe("AiContextBlock", () => {
  const block = new AiContextBlock();

  it("appends a delimited block and strips it back for display", ({
    expect,
  }) => {
    const content = block.append("why late?", {
      route: "/invoices/7",
      data: { id: 7 },
    });
    expect(content).toBe(
      'why late?\n\n<page-context>\n{"route":"/invoices/7","data":{"id":7}}\n</page-context>',
    );
    expect(block.strip(content)).toBe("why late?");
    expect(block.strip("no block here")).toBe("no block here");
  });

  it("leaves a message without context unchanged", ({ expect }) => {
    expect(block.append("hi")).toBe("hi");
    expect(block.append("hi", {})).toBe("hi");
  });

  it("cuts on a character boundary, under the cap, with a marker", ({
    expect,
  }) => {
    const json = block.serialize({ data: "€".repeat(5000) });
    expect(json.endsWith("...[truncated]")).toBe(true);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(8192);
    expect(json).not.toContain("�");
  });
});
