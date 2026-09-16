import { act, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { uiAtom } from "alepha/react/ui";
import { toast } from "sonner";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Toaster } from "../Toaster.tsx";

/**
 * The kit's toaster is sonner with two decisions of its own: every toast can
 * be dismissed by hand (`closeButton`), and its colour scheme is Alepha's
 * `useColorMode`, not `next-themes`, which is not a dependency here.
 *
 * Each test raises its own message: sonner's toast store is module-level, so
 * what one test raised is still there for the next.
 */
describe("Toaster", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (mode?: "light" | "dark") => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    if (mode) {
      alepha.store.set(uiAtom, { ...uiAtom.options.default!, mode });
    }
    render(
      <AlephaContext.Provider value={alepha}>
        <Toaster visibleToasts={20} />
      </AlephaContext.Provider>,
    );
  };

  const toastWith = (text: string) =>
    [...document.querySelectorAll("[data-sonner-toast]")].find((it) =>
      it.textContent?.includes(text),
    );

  it("gives every toast a close button", async () => {
    await mount();
    act(() => {
      toast("Saved the folio");
    });

    await waitFor(() => expect(toastWith("Saved the folio")).toBeTruthy());
    expect(
      toastWith("Saved the folio")?.querySelector("[data-close-button]"),
    ).not.toBeNull();
  });

  it("follows the app's colour mode", async () => {
    await mount("dark");
    act(() => {
      toast("Dark toast");
    });

    await waitFor(() => expect(toastWith("Dark toast")).toBeTruthy());
    const toaster = document.querySelector("[data-sonner-toaster]");
    expect(toaster?.getAttribute("data-sonner-theme")).toBe("dark");
  });

  it("follows a light colour mode too", async () => {
    await mount("light");
    act(() => {
      toast("Light toast");
    });

    await waitFor(() => expect(toastWith("Light toast")).toBeTruthy());
    const toaster = document.querySelector("[data-sonner-toaster]");
    expect(toaster?.getAttribute("data-sonner-theme")).toBe("light");
  });
});
