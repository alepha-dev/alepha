import { fireEvent, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { $page, AlephaReactRouter } from "alepha/react/router";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { PlateLayout } from "../plate-layout.tsx";
import type { PlateTab } from "../plate-tab-bar.tsx";

/**
 * A full-width plate over a tab strip, lifted out of Lore's Release view so
 * Reports and an enrolled app's page can be the same shape (#1693).
 *
 * The two tab kinds are the point of the component. A tab that swaps a panel
 * inside one route is state; a tab that IS its own route has to be a link, or
 * middle-click, copy-link and the back button all stop working.
 */
class Routes {
  overview = $page({ name: "overview", path: "/o", component: () => null });
  details = $page({ name: "details", path: "/d", component: () => null });
}

describe("PlateLayout", () => {
  const mount = async (ui: ReactNode) => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactRouter);
    alepha.inject(Routes);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  const stateTabs: PlateTab[] = [
    { key: "overview", label: "Overview" },
    { key: "contents", label: "Contents", count: 3 },
  ];

  const linkTabs: PlateTab[] = [
    { key: "overview", label: "Overview", href: "/o" },
    { key: "details", label: "Details", href: "/d" },
  ];

  it("renders the plate above the tabs and the body under both", async () => {
    const view = await mount(
      <PlateLayout
        plate={<h1>0.28.0</h1>}
        tabs={stateTabs}
        active="overview"
        tabsTestId="probe-tabs"
      >
        <p>body</p>
      </PlateLayout>,
    );

    expect(view.getByRole("heading", { name: "0.28.0" })).toBeTruthy();
    expect(view.getByText("body")).toBeTruthy();
    expect(view.getByTestId("probe-tabs")).toBeTruthy();
    // The rule that separates the tabs from the plate above them.
    expect(view.getByTestId("probe-tabs").className).toContain("border-t");
  });

  /**
   * `plate` has always been optional and had never been exercised, which is
   * how the tab bar's top rule came to be unconditional: with no plate it
   * drew a stray line immediately under the container's own top edge
   * (feedback #2095, found by Reports dropping a plate that only reprinted
   * its breadcrumb leaf).
   */
  it("drops the tab bar's top rule when there is no plate", async () => {
    const view = await mount(
      <PlateLayout tabs={stateTabs} active="overview" tabsTestId="probe-tabs">
        <p>body</p>
      </PlateLayout>,
    );

    expect(view.getByTestId("probe-tabs").className).not.toContain("border-t");
    // The tabs themselves are unchanged: still there, still the right height.
    expect(view.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(view.getByText("body")).toBeTruthy();
  });

  it("calls back with the tab key when a stateful tab is pressed", async () => {
    const picked: string[] = [];
    const view = await mount(
      <PlateLayout
        tabs={stateTabs}
        active="overview"
        onSelect={(key) => picked.push(key)}
      >
        <p>body</p>
      </PlateLayout>,
    );

    fireEvent.click(view.getByRole("tab", { name: /Contents/ }));

    expect(picked).toEqual(["contents"]);
  });

  it("marks the active stateful tab with aria-selected", async () => {
    const view = await mount(
      <PlateLayout tabs={stateTabs} active="contents">
        <p>body</p>
      </PlateLayout>,
    );

    expect(
      view.getByRole("tab", { name: /Contents/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      view.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  /**
   * ⚠️ The regression this exists for. `role="tab"` on an anchor overrides the
   * implicit link role: it takes the tab out of `getByRole("link")`, which is
   * how Lore's sigil e2e reaches every one of an app's tabs, and it tells a
   * screen reader the control swaps a panel when it actually leaves the page.
   */
  it("keeps a routed tab a link, marked with aria-current", async () => {
    const view = await mount(
      <PlateLayout tabs={linkTabs} active="details" tabsTestId="probe-tabs">
        <p>body</p>
      </PlateLayout>,
    );

    const bar = view.getByTestId("probe-tabs");
    expect(bar.getAttribute("role")).toBe("navigation");
    expect(view.getAllByRole("link").length).toBe(2);

    const active = view.getByRole("link", { name: "Details" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.getAttribute("href")).toBe("/d");
    expect(
      view.getByRole("link", { name: "Overview" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("shows a count only once it has one", async () => {
    const view = await mount(
      <PlateLayout
        tabs={[
          { key: "a", label: "Resolved", count: 0 },
          { key: "b", label: "Pending" },
        ]}
        active="a"
      >
        <p>body</p>
      </PlateLayout>,
    );

    // A resolved zero IS shown - it is an answer. An unresolved count is not,
    // because a confident "0" while the collection is still loading is a lie.
    expect(view.getByRole("tab", { name: /Resolved/ }).textContent).toContain(
      "0",
    );
    expect(view.getByRole("tab", { name: /Pending/ }).textContent).toBe(
      "Pending",
    );
  });

  it("owns the body's scroll region, unless the body says otherwise", async () => {
    // Scoped to each render: `getByTestId` searches the whole document, and
    // the second mount below leaves the first one's tree in place.
    const scrolled = await mount(
      <PlateLayout tabs={stateTabs} active="overview">
        <p data-testid="body">body</p>
      </PlateLayout>,
    );
    expect(
      scrolled.container.querySelector('[data-testid="body"]')?.parentElement
        ?.className,
    ).toContain("overflow-y-auto");

    // A tab with a sticky toolbar or a reading measure scrolls itself, and
    // nesting a scroll region inside one gives it two.
    const bare = await mount(
      <PlateLayout tabs={stateTabs} active="overview" scroll={false}>
        <p data-testid="body">body</p>
      </PlateLayout>,
    );
    expect(
      bare.container.querySelector('[data-testid="body"]')?.parentElement
        ?.className,
    ).not.toContain("overflow-y-auto");
  });
});
