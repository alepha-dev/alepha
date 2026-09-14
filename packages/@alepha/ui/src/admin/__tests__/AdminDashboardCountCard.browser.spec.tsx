import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { type ReactNode, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../core/Toaster.tsx";
import { ActionErrorToaster } from "../../shell/ActionErrorToaster.tsx";
import { AdminDashboardCountCard } from "../AdminDashboardCountCard.tsx";

/**
 * The dashboard tile, on `useQuery` (#Q2320).
 *
 * Its callers pass `load` inline, a fresh closure on every render of the
 * parent: the card must not refetch for that, and a failed count must render
 * the dash without a toast, because a dashboard is glanceable and one
 * unreachable number is not an event.
 */
describe("AdminDashboardCountCard", () => {
  let alepha: Alepha | undefined;

  const DASH = "—";
  const PENDING = "…";

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: ReactNode) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Toaster visibleToasts={20} />
        <ActionErrorToaster />
        {ui}
      </AlephaContext.Provider>,
    );
  };

  const figure = (view: ReturnType<typeof render>) =>
    view.container.querySelector(".tabular-nums")?.textContent;

  it("shows the pending mark, then the value", async () => {
    let release: ((n: number) => void) | undefined;
    const view = await mount(
      <AdminDashboardCountCard
        label="Orders"
        href="/admin/orders-pending"
        load={() =>
          new Promise<number>((resolve) => {
            release = resolve;
          })
        }
      />,
    );

    expect(figure(view)).toBe(PENDING);
    // The query calls `load` after its begin event, not during the render.
    await waitFor(() => expect(release).toBeDefined());
    expect(figure(view)).toBe(PENDING);
    release!(1234);
    await waitFor(() => expect(figure(view)).toBe((1234).toLocaleString()));
  });

  it("renders the dash for a failed count, and does not toast", async () => {
    const view = await mount(
      <AdminDashboardCountCard
        label="Products"
        href="/admin/products-failing"
        load={async () => {
          throw new Error("Count unreachable (card spec)");
        }}
      />,
    );

    await waitFor(() => expect(figure(view)).toBe(DASH));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText("Count unreachable (card spec)")).toBeNull();
  });

  it("does not refetch when the parent re-renders with a new load closure", async () => {
    let calls = 0;
    const Parent = () => {
      const [tick, setTick] = useState(0);
      return (
        <div data-tick={tick}>
          <button type="button" onClick={() => setTick((n) => n + 1)}>
            re-render
          </button>
          <AdminDashboardCountCard
            label="Users"
            href="/admin/users-stable"
            load={async () => {
              calls++;
              return 7;
            }}
          />
        </div>
      );
    };
    const view = await mount(<Parent />);

    await waitFor(() => expect(figure(view)).toBe("7"));
    fireEvent.click(screen.getByText("re-render"));
    fireEvent.click(screen.getByText("re-render"));
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-tick]")?.getAttribute("data-tick"),
      ).toBe("2"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
  });
});
