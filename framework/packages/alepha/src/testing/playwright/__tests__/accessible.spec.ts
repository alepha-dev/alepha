import { describe, it } from "vitest";

import { formatAccessibilityFindings } from "../accessible.ts";

describe("formatAccessibilityFindings", () => {
  it("names the rule, its help URL, the selector and the HTML of each node", ({
    expect,
  }) => {
    const message = formatAccessibilityFindings([
      {
        rule: "button-name",
        help: "Buttons must have discernible text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.14/button-name",
        selector: "iframe#viewport #save",
        html: '<button id="save"></button>',
      },
    ]);
    expect(message).toContain("axe found 1 accessibility violation(s):");
    expect(message).toContain(
      "[button-name] Buttons must have discernible text",
    );
    expect(message).toContain(
      "https://dequeuniversity.com/rules/axe/4.14/button-name",
    );
    expect(message).toContain("  iframe#viewport #save");
    expect(message).toContain('    <button id="save"></button>');
  });
});
