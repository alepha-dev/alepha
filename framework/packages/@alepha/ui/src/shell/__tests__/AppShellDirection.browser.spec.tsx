import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AppShell } from "../AppShell.tsx";
import type { NavGroup } from "../appShellNav.tsx";

/**
 * The shell for an app that reads right to left, and for assistive
 * technology (#Q2760):
 *
 * - the sidebar sits on the inline START, so a right-to-left page puts it on
 *   the right. jsdom does no layout, so the class is the evidence: `start-0`
 *   and `border-e`, never the physical `left-0` / `border-r` it used to be
 *   pinned with;
 * - a collapsible nav group is a disclosure: `aria-expanded` follows it, and
 *   `aria-controls` names the panel it opens;
 * - the collapse button's name comes from the catalogue, not a literal.
 */
describe("AppShell direction and disclosure", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const NAV: NavGroup[] = [
    {
      items: [
        {
          label: "Projects",
          children: [{ href: "/projects/active", label: "Active" }],
        },
      ],
    },
  ];

  const mount = async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AppShell nav={NAV}>
          <div />
        </AppShell>
      </AlephaContext.Provider>,
    );
  };

  it("pins the sidebar to the inline start, not the left", async () => {
    const ui = await mount();
    const container = ui.container.querySelector(
      '[data-slot="sidebar-container"]',
    )!;

    expect(container.getAttribute("data-side")).toBe("start");
    const classes = container.getAttribute("class") ?? "";
    expect(classes).toContain("data-[side=start]:start-0");
    expect(classes).toContain("group-data-[side=start]:border-e");
  });

  it("marks a nav group expanded or not, and names its panel", async () => {
    await mount();
    const group = screen.getByRole("button", { name: "Projects" });

    expect(group.getAttribute("aria-expanded")).toBe("false");
    const panelId = group.getAttribute("aria-controls")!;
    expect(document.getElementById(panelId)?.getAttribute("data-state")).toBe(
      "closed",
    );

    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(panelId)?.getAttribute("data-state")).toBe(
      "open",
    );
  });

  it("names the collapse button through the catalogue", async () => {
    await mount();

    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeTruthy();
  });
});
