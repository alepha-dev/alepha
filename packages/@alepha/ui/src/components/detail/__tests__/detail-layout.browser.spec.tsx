import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { User } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DetailLayout } from "../detail-layout.tsx";

/**
 * The shell every admin detail page composes, so what it pins is the contract
 * those pages rely on: the loading and not-found states replace everything
 * (a page must never render half a shell over missing data), the aside and
 * actions reach the DOM, and only the selected tab's body is mounted.
 */
describe("DetailLayout", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  const tabs = [
    { value: "overview", label: "Overview", icon: User },
    { value: "stock", label: "Stock" },
  ];

  it("renders the aside, the tabs and the actions", async () => {
    await mount(
      <DetailLayout
        aside={<p>identity panel</p>}
        tabs={tabs}
        tab="overview"
        onTabChange={() => {}}
        actions={<button type="button">Publish</button>}
      >
        <p>overview body</p>
      </DetailLayout>,
    );

    expect(screen.getByText("identity panel")).toBeTruthy();
    expect(screen.getByText("overview body")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Stock")).toBeTruthy();
  });

  it("reports the picked tab's value to onTabChange", async () => {
    const onTabChange = vi.fn();
    await mount(
      <DetailLayout
        aside={null}
        tabs={tabs}
        tab="overview"
        onTabChange={onTabChange}
      />,
    );

    screen.getByText("Stock").click();

    expect(onTabChange).toHaveBeenCalledWith("stock");
  });

  /**
   * The whole reason `loading` lives on the layout rather than at each call
   * site: a page that rendered its aside from a half-loaded record would read
   * as real data.
   */
  it("replaces the entire shell while loading", async () => {
    await mount(
      <DetailLayout
        loading
        aside={<p>identity panel</p>}
        tabs={tabs}
        tab="overview"
        onTabChange={() => {}}
        actions={<button type="button">Publish</button>}
      >
        <p>overview body</p>
      </DetailLayout>,
    );

    expect(screen.queryByText("identity panel")).toBeNull();
    expect(screen.queryByText("overview body")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("replaces the entire shell when not found, and offers the way back", async () => {
    const onBack = vi.fn();
    await mount(
      <DetailLayout
        notFound={{
          message: "Product not found.",
          backLabel: "Back to catalogue",
          onBack,
        }}
        aside={<p>identity panel</p>}
        tabs={tabs}
        tab="overview"
        onTabChange={() => {}}
      >
        <p>overview body</p>
      </DetailLayout>,
    );

    expect(screen.queryByText("identity panel")).toBeNull();
    expect(screen.queryByText("overview body")).toBeNull();
    expect(screen.getByText("Product not found.")).toBeTruthy();

    screen.getByRole("button", { name: /Back to catalogue/ }).click();
    expect(onBack).toHaveBeenCalled();
  });

  /**
   * The content column carries BOTH axis escapes.
   *
   * It is a flex item on the shell row's horizontal main axis, so without
   * `min-w-0` its `min-width: auto` resolves to its content's min-content
   * width and it refuses to shrink. A tab body wider than the viewport (the
   * epic Flow tab's questline board is `w-max`) then stretches the column
   * past the viewport rather than overflowing inside it: the body's own
   * `overflow-auto` never sees an overflow, so no scrollbar appears, and the
   * row's `overflow-hidden` clips the remainder out of reach.
   *
   * ⚠️ jsdom does no layout, so this can only pin the class. The measurement
   * that proves the behaviour was taken in a real browser: on a 1276px
   * viewport with a 16-card questline the column is 3160px wide and
   * `scrollWidth === clientWidth` without `min-w-0`, and 988px wide with
   * 2172px of horizontal scroll with it.
   */
  it("lets the content column shrink on both axes", async () => {
    const { container } = await mount(
      <DetailLayout
        aside={<p>identity panel</p>}
        tabs={tabs}
        tab="overview"
        onTabChange={() => {}}
      >
        <p>overview body</p>
      </DetailLayout>,
    );

    const column = container.querySelector("aside")?.nextElementSibling;

    expect(column).toBeTruthy();
    expect(column?.className).toContain("min-w-0");
    expect(column?.className).toContain("min-h-0");
  });

  /**
   * `loading` wins over `notFound`. A page computes "not found" as "no record",
   * which is also true on the very first render — ordering it the other way
   * flashes "not found" before every successful load.
   */
  it("prefers the loading state over not-found", async () => {
    await mount(
      <DetailLayout
        loading
        notFound={{
          message: "Product not found.",
          backLabel: "Back",
          onBack: () => {},
        }}
        aside={null}
        tabs={tabs}
        tab="overview"
        onTabChange={() => {}}
      />,
    );

    expect(screen.queryByText("Product not found.")).toBeNull();
  });
});
