import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "../Badge.tsx";

/**
 * `tint` and `tone` are the kit's additions to the badge: a status chip whose
 * label stays body text and whose hue is a semantic name. The tone paints only
 * under `tint`; every other variant keeps its own fill.
 */
describe("Badge tone", () => {
  it("paints the tone's wash and border under variant tint", () => {
    render(
      <Badge variant="tint" tone="info">
        In progress
      </Badge>,
    );
    const badge = screen.getByText("In progress");

    expect(badge.getAttribute("data-slot")).toBe("badge");
    expect(badge.className).toContain("bg-blue-500/15");
    expect(badge.className).toContain("border-blue-500/40");
    expect(badge.className).toContain("text-foreground");
  });

  it.each([
    ["neutral", "bg-muted"],
    ["success", "bg-emerald-500/15"],
    ["warning", "bg-amber-500/15"],
    ["danger", "bg-red-500/15"],
  ] as const)("paints %s with %s", (tone, fill) => {
    render(
      <Badge variant="tint" tone={tone}>
        {tone}
      </Badge>,
    );

    expect(screen.getByText(tone).className).toContain(fill);
  });

  it("ignores a tone under any other variant", () => {
    render(<Badge tone="danger">Default</Badge>);
    const badge = screen.getByText("Default");

    expect(badge.className).toContain("bg-primary");
    expect(badge.className).not.toContain("bg-red-500/15");
    expect(badge.className).not.toContain("border-red-500/40");
  });
});
