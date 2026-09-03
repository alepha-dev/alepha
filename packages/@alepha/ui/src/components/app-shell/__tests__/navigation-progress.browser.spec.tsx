import { render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { setupJsdomMocks } from "alepha/react/testing";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { NavigationProgress } from "../navigation-progress.tsx";

/**
 * The bar draws for a transition it is mounted across, and for no other.
 *
 * That sounds like a restatement of how `useEvents` works, and it is - but it
 * is also the whole reason this component was pulled out of `AppShell`. Mounted
 * inside a shell, the two navigations it cannot cover are precisely the ones
 * that enter and leave that shell: `begin` fires before the destination's
 * layers exist, and `NestedView` swaps the view on `end`. An application whose
 * landing page has no shell therefore had a bar on every move within a section
 * and none on the move into one, which reads as a broken indicator rather than
 * as an absent one.
 *
 * These tests pin the contract a root mount relies on: silent until a
 * transition starts, visible for its whole duration, gone after it lands, and
 * still correct when a second navigation interrupts the first.
 */
describe("NavigationProgress", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: ReactNode) => {
    alepha = Alepha.create();
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
    return alepha;
  };

  const begin = (app: Alepha) =>
    app.events.emit(
      "react:transition:begin",
      { previous: {}, state: {} } as never,
      { catch: true },
    );

  const end = (app: Alepha) =>
    app.events.emit("react:transition:end", { state: {} } as never, {
      catch: true,
    });

  it("renders nothing until a transition starts", async () => {
    await mount(<NavigationProgress />);

    expect(screen.queryByTestId("navigation-progress")).toBeNull();
  });

  it("shows the bar while a transition is in flight", async () => {
    const app = await mount(<NavigationProgress />);

    await begin(app);

    await waitFor(() => {
      expect(screen.getByTestId("navigation-progress")).toBeTruthy();
    });
  });

  it("takes the bar away once the transition lands", async () => {
    const app = await mount(<NavigationProgress />);

    await begin(app);
    await waitFor(() => {
      expect(screen.getByTestId("navigation-progress")).toBeTruthy();
    });

    await end(app);

    await waitFor(() => {
      expect(screen.queryByTestId("navigation-progress")).toBeNull();
    });
  });

  it("keeps one bar when a second navigation interrupts the first", async () => {
    const app = await mount(<NavigationProgress />);

    // The case that used to leak an interval per interrupted navigation: the
    // second `begin` overwrote the ref without clearing the first timer.
    await begin(app);
    await begin(app);
    await end(app);

    await waitFor(() => {
      expect(screen.queryByTestId("navigation-progress")).toBeNull();
    });

    // A leaked interval would still be calling `setProgress` on an unmounted
    // tree, so nothing may bring the bar back on its own.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByTestId("navigation-progress")).toBeNull();
  });

  it("takes its height and colour from the caller", async () => {
    const app = await mount(
      <NavigationProgress className="bg-destructive" height={4} />,
    );

    await begin(app);

    await waitFor(() => {
      const container = screen.getByTestId("navigation-progress");
      expect(container.style.height).toBe("4px");
      expect(container.querySelector(".bg-destructive")).toBeTruthy();
    });
  });
});
