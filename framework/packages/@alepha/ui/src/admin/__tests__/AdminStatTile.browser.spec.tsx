import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { expectAccessible, setupJsdomMocks } from "alepha/testing/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../../core/Toaster.tsx";
import { ActionErrorToaster } from "../../shell/ActionErrorToaster.tsx";
import { AdminStatTile } from "../AdminStatTile.tsx";

/**
 * The dashboard's stat tile (#Q3534), on `useQuery` (#Q2320).
 *
 * Its callers pass `load` inline, a fresh closure on every render of the
 * parent: the tile must not refetch for that, and a failed count must render
 * "n/a" without a toast, because a dashboard is glanceable and one
 * unreachable number is not an event.
 */
describe("AdminStatTile", () => {
  let alepha: Alepha | undefined;

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

  const figure = (view: ReturnType<typeof render>, index = 0) =>
    view.container.querySelectorAll("[data-slot=stat-value]")[index]
      ?.textContent;

  const chip = (view: ReturnType<typeof render>) =>
    view.container.querySelector("[data-slot=stat-delta]");

  it("shows the pending mark, then the value", async () => {
    let release: ((n: number) => void) | undefined;
    const view = await mount(
      <AdminStatTile
        id="orders-pending"
        label="Orders"
        href="/admin/orders"
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

  it("renders n/a for a failed count, no dash, and does not toast", async () => {
    const view = await mount(
      <AdminStatTile
        id="products-failing"
        label="Products"
        href="/admin/products"
        load={async () => {
          throw new Error("Count unreachable (tile spec)");
        }}
      />,
    );

    await waitFor(() => expect(figure(view)).toBe("n/a"));
    expect(view.container.textContent).not.toContain("—");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText("Count unreachable (tile spec)")).toBeNull();
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
          <AdminStatTile
            id="users-stable"
            label="Users"
            href="/admin/users"
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

  it("keys its query on the card id, so two tiles on one list are two numbers", async () => {
    const view = await mount(
      <>
        <AdminStatTile
          id="same-list-a"
          label="A"
          href="/admin/users"
          load={async () => 1}
        />
        <AdminStatTile
          id="same-list-b"
          label="B"
          href="/admin/users"
          load={async () => 2}
        />
      </>,
    );

    await waitFor(() => expect(figure(view, 0)).toBe("1"));
    await waitFor(() => expect(figure(view, 1)).toBe("2"));
  });

  it("is one link around the whole card, to href", async () => {
    const view = await mount(
      <AdminStatTile
        id="link-target"
        label="Users"
        tooltip="Every account in this realm"
        note="Disabled accounts included."
        href="/admin/users?filters=none"
        load={async () => 3}
      />,
    );

    await waitFor(() => expect(figure(view)).toBe("3"));
    const links = view.container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.getAttribute("href")).toBe("/admin/users?filters=none");
    expect(
      link.contains(view.container.querySelector("[data-slot=card]")),
    ).toBe(true);
    // The tooltip is read out with the link, not only on hover.
    const describedBy = link.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      "Every account in this realm",
    );
    expect(link.textContent).toContain("Disabled accounts included.");
    await expectAccessible(view.container);
  });

  it("shows a chip comparing the value with previous", async () => {
    const view = await mount(
      <AdminStatTile
        id="previous-chip"
        label="Failed sign-ins"
        href="/admin/audits"
        load={async () => ({ value: 15, previous: 10 })}
      />,
    );

    await waitFor(() => expect(chip(view)?.textContent).toContain("+50%"));
    expect(chip(view)?.textContent).toContain("vs the previous period");
  });

  it("shows a chip comparing another number through delta, with its label", async () => {
    const view = await mount(
      <AdminStatTile
        id="delta-chip"
        label="Users"
        href="/admin/users"
        load={async () => ({
          value: 120,
          delta: { current: 4, previous: 0, label: "Sign-ups vs the 7 before" },
        })}
        note={(loaded) => `${loaded.delta?.current} sign-ups in 7 days`}
      />,
    );

    await waitFor(() => expect(figure(view)).toBe("120"));
    expect(chip(view)?.textContent).toContain("new");
    expect(chip(view)?.textContent).toContain("Sign-ups vs the 7 before");
    expect(view.container.textContent).toContain("4 sign-ups in 7 days");
  });

  it("shows no chip when load returns a bare number", async () => {
    const view = await mount(
      <AdminStatTile
        id="no-chip"
        label="Connected"
        href="/admin/users"
        load={async () => 9}
      />,
    );

    await waitFor(() => expect(figure(view)).toBe("9"));
    expect(chip(view)).toBeNull();
  });

  it("turns warning-coloured only when the alert predicate holds", async () => {
    const view = await mount(
      <>
        <AdminStatTile
          id="alert-on"
          label="Over"
          href="/admin/audits"
          load={async () => 11}
          alert={(value) => value > 10}
        />
        <AdminStatTile
          id="alert-off"
          label="Under"
          href="/admin/audits"
          load={async () => 10}
          alert={(value) => value > 10}
        />
      </>,
    );

    await waitFor(() => expect(figure(view, 1)).toBe("10"));
    await waitFor(() => expect(figure(view, 0)).toBe("11"));
    const [over, under] = Array.from(view.container.querySelectorAll("a"));
    expect(over!.hasAttribute("data-alert")).toBe(true);
    expect(under!.hasAttribute("data-alert")).toBe(false);
  });
});
