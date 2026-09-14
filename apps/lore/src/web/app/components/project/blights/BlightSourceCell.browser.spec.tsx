import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BlightSourceCell from "./BlightSourceCell.tsx";

/**
 * The blight inbox's Page cell (feedback #P2200). `sourceUrl` takes three
 * shapes and only a page URL names a place, and it is reporter-controlled
 * telemetry, so the scheme decides and nothing else does.
 */
describe("BlightSourceCell", () => {
  it("links a full https page URL out, in a new tab, with the outbound icon", ({
    expect,
  }) => {
    const url = "https://lore.alepha.dev/alepha/quests";
    const ui = render(<BlightSourceCell sourceUrl={url} />);

    const link = ui.getByRole("link");
    expect(link.getAttribute("href")).toBe(url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("title")).toBe(url);
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.querySelector(".truncate")?.textContent).toBe(url);
  });

  it("links a plain http page URL too", ({ expect }) => {
    const ui = render(
      <BlightSourceCell sourceUrl="http://localhost:3303/alepha/quests" />,
    );

    expect(ui.getByRole("link").getAttribute("href")).toBe(
      "http://localhost:3303/alepha/quests",
    );
  });

  it.each([
    ["a route pattern", "/api/projects/:projectId/apps/:app/:env/destroy"],
    ["a job name", "job:lore.deploy.run"],
    ["a javascript: URL", "javascript:alert(document.cookie)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
  ])("keeps %s as truncated text with the full value on hover", (_, value) => {
    const ui = render(<BlightSourceCell sourceUrl={value} />);

    expect(ui.queryByRole("link")).toBeNull();
    const text = ui.getByTitle(value);
    expect(text.textContent).toBe(value);
    expect(text.className).toContain("truncate");
  });

  it("shows a placeholder when there is no source", ({ expect }) => {
    const ui = render(<BlightSourceCell sourceUrl="" />);

    expect(ui.queryByRole("link")).toBeNull();
    expect(ui.container.textContent).toBe("-");
  });

  it("stops the click at the link, so no row action fires under it", ({
    expect,
  }) => {
    let rowClicks = 0;
    const ui = render(
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for a table row's click handler
      <div onClick={() => rowClicks++}>
        <BlightSourceCell sourceUrl="https://lore.alepha.dev/alepha/quests" />
      </div>,
    );

    fireEvent.click(ui.getByRole("link"));

    expect(rowClicks).toBe(0);
  });
});
