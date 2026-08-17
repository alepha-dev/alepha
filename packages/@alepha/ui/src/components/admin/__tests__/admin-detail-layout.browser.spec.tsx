import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { User } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminDetailLayout } from "../admin-detail-layout.tsx";

/**
 * The shell every admin detail page composes, so what it pins is the contract
 * those pages rely on: the loading and not-found states replace everything
 * (a page must never render half a shell over missing data), the aside and
 * actions reach the DOM, and only the selected tab's body is mounted.
 */
describe("AdminDetailLayout", () => {
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
      <AdminDetailLayout
        aside={<p>identity panel</p>}
        tabs={tabs}
        tab="overview"
        onTabChange={() => {}}
        actions={<button type="button">Publish</button>}
      >
        <p>overview body</p>
      </AdminDetailLayout>,
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
      <AdminDetailLayout
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
      <AdminDetailLayout
        loading
        aside={<p>identity panel</p>}
        tabs={tabs}
        tab="overview"
        onTabChange={() => {}}
        actions={<button type="button">Publish</button>}
      >
        <p>overview body</p>
      </AdminDetailLayout>,
    );

    expect(screen.queryByText("identity panel")).toBeNull();
    expect(screen.queryByText("overview body")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("replaces the entire shell when not found, and offers the way back", async () => {
    const onBack = vi.fn();
    await mount(
      <AdminDetailLayout
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
      </AdminDetailLayout>,
    );

    expect(screen.queryByText("identity panel")).toBeNull();
    expect(screen.queryByText("overview body")).toBeNull();
    expect(screen.getByText("Product not found.")).toBeTruthy();

    screen.getByRole("button", { name: /Back to catalogue/ }).click();
    expect(onBack).toHaveBeenCalled();
  });

  /**
   * `loading` wins over `notFound`. A page computes "not found" as "no record",
   * which is also true on the very first render — ordering it the other way
   * flashes "not found" before every successful load.
   */
  it("prefers the loading state over not-found", async () => {
    await mount(
      <AdminDetailLayout
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
