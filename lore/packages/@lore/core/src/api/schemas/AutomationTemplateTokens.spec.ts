import { describe, it } from "vitest";

import { AutomationTemplateTokens } from "./AutomationTemplateTokens.ts";

describe("Automation template reference discovery", () => {
  it("walks only string values and accepts nested object braces and spaced placeholders", ({
    expect,
  }) => {
    const tokens = new AutomationTemplateTokens();
    const rule = {
      trigger: { kind: "schedule", cron: "{{ schedule }}" },
      select: { filters: { tag: "{{tag}}" } },
      actions: [{ text: "Hello {{title}}, {{ member }}", count: 3 }],
      ignored: { number: 0, nil: null, enabled: false },
    };
    expect(tokens.inValue(rule)).toEqual([
      "schedule",
      "tag",
      "title",
      "member",
    ]);
    expect(tokens.inValue({ nested: { child: {} } })).toEqual([]);
    expect(tokens.inValue(["{{x}}", { text: "{{ x }}" }])).toEqual(["x", "x"]);
    expect(() => tokens.inValue({ text: "{{user.name}}" })).toThrow(
      "Invalid placeholder",
    );
  });
});
