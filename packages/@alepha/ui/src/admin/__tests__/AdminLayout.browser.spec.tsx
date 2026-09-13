import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import AdminLayout from "../admin-layout.tsx";
import {
  type AdminRouterOptions,
  adminRouterOptionsAtom,
} from "../admin-router-options.tsx";
import { AdminRouter } from "../admin-router.tsx";

/**
 * The three seams `adminRouterOptionsAtom` opens into the layout itself —
 * as opposed to the routing contract, which `admin-router.spec.ts` owns.
 *
 * Each exists for an application whose `/admin` lives inside a document it
 * does not fully own (a host page with fixed overlays, or a hardcoded
 * `<html class="dark">`): `className` is the fence hook, `colorScheme:
 * false` keeps the shell from rewriting the host's theme class, and the ⌘K
 * search affordance surviving a `topbarActions` replacement is what makes
 * replacing the cluster safe — the Spotlight state is local to the layout,
 * so no replacement cluster could ever rebuild the button.
 */
describe("AdminLayout options", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    document.documentElement.className = "";
  });

  const mount = async (options: AdminRouterOptions) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(AdminRouter);
    alepha.set(adminRouterOptionsAtom, options);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <AdminLayout />
      </AlephaContext.Provider>,
    );
  };

  it("merges options.className onto the shell root", async () => {
    const { container } = await mount({ className: "admin-fence" });

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root!.classList.contains("admin-fence")).toBe(true);
    // Merged, not replaced — the viewport bound stays.
    expect(root!.classList.contains("h-svh")).toBe(true);
  });

  it("colorScheme: false leaves the document's theme class alone", async () => {
    // A host document that owns its own theme class, the way a game shell
    // hardcodes `<html class="dark">`. `<ColorScheme />` mounted here would
    // toggle it off (jsdom resolves the color mode light), which is exactly
    // the rewrite the opt-out exists to prevent.
    document.documentElement.classList.add("dark");

    await mount({ colorScheme: false });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("keeps the ⌘K search affordance when topbarActions is replaced", async () => {
    await mount({ topbarActions: <span>custom-cluster</span> });

    expect(screen.getByText("custom-cluster")).toBeTruthy();
    // The search button is not part of the replaceable cluster: its open
    // state lives in the layout, so replacing the cluster must not cost it.
    expect(screen.getByText("Search…")).toBeTruthy();
  });
});
