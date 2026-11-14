import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import ProjectSettingsBody from "./ProjectSettingsBody.tsx";

/**
 * The settings body (#Q3658): a page of setting blocks is bounded by the
 * centred column, a `fullWidth` tab (Hosts, Ranks) is not.
 */
describe("ProjectSettingsBody", () => {
  afterEach(() => {
    cleanup();
  });

  it("should bound a page of setting blocks in the centred column", ({
    expect,
  }) => {
    render(
      <ProjectSettingsBody>
        <p>blocks</p>
      </ProjectSettingsBody>,
    );

    const body = screen.getByTestId("settings-body");
    expect(body.className).toContain("max-w-6xl");
    expect(body.className).toContain("mx-auto");
    expect(body.dataset.fullWidth).toBeUndefined();
  });

  it("should give a fullWidth page the whole body, down to its bottom", ({
    expect,
  }) => {
    render(
      <ProjectSettingsBody fullWidth>
        <p>table</p>
      </ProjectSettingsBody>,
    );

    const body = screen.getByTestId("settings-body");
    expect(body.className).not.toContain("max-w-6xl");
    expect(body.className).toContain("min-h-full");
    expect(body.dataset.fullWidth).toBe("true");
  });
});
