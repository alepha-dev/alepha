import type { HostJobResource } from "@lore/core/schemas";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import JobStatusBadge from "./JobStatusBadge.tsx";

/**
 * A job's status chip (#Q4306): tinted in its status's hue, the colours its
 * glyph has on the rail, so a list of jobs reads at a glance.
 */
describe("JobStatusBadge", () => {
  afterEach(() => cleanup());

  const TONES: Array<[HostJobResource["status"], string, string]> = [
    ["queued", "neutral", "bg-muted"],
    ["running", "warning", "bg-warning/15"],
    ["succeeded", "success", "bg-success/15"],
    ["failed", "danger", "bg-danger/15"],
    ["cancelled", "neutral", "bg-muted"],
    ["timed_out", "danger", "bg-danger/15"],
  ];

  for (const [status, tone, fill] of TONES) {
    it(`tints ${status} ${tone}`, ({ expect }) => {
      render(<JobStatusBadge status={status} />);
      const badge = screen.getByTestId("job-status");
      expect(badge.getAttribute("data-status")).toBe(status);
      expect(badge.getAttribute("data-tone")).toBe(tone);
      expect(badge.className.split(/\s+/)).toContain(fill);
      expect(badge.textContent).toBe(status);
    });
  }

  it("spins only a running job's glyph", ({ expect }) => {
    render(<JobStatusBadge status="running" />);
    expect(
      screen
        .getByTestId("job-status")
        .querySelector("svg")
        ?.getAttribute("class"),
    ).toContain("animate-spin");
  });
});
