import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import { folioTextSizeAtom } from "../../../../atoms/folioTextSizeAtom.ts";
import { I18n } from "../../../../services/I18n.ts";
import type { FolioActionHandlers } from "../useFolioActions.ts";
import FolioMenubar from "./FolioMenubar.tsx";
import type { FolioActionState } from "./folioMenubarModel.ts";

/**
 * Every action is a no-op here: what this file tests is the reading-size
 * radio group, which writes an atom rather than dispatching an action.
 */
const noHandlers = new Proxy({} as FolioActionHandlers, {
  get: () => () => {},
});

const anOpenFolio: FolioActionState = {
  locked: false,
  isNew: false,
  dirty: false,
  isProtected: false,
  isPinned: false,
  editing: false,
};

describe("the folio menubar's reading size", () => {
  const mount = async (state: FolioActionState = anOpenFolio) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();

    render(
      <AlephaContext.Provider value={alepha}>
        <FolioMenubar handlers={noHandlers} state={state} mode="view" />
      </AlephaContext.Provider>,
    );

    // Base UI opens a menu from its trigger on a key as well as a press;
    // the key path is the one jsdom drives reliably.
    const view = await screen.findByRole("menuitem", { name: "View" });
    fireEvent.keyDown(view, { key: "ArrowDown" });

    return alepha;
  };

  it("offers three levels and marks the stored one", async ({ expect }) => {
    const alepha = await mount();

    const levels = await screen.findAllByRole("menuitemradio");
    expect(levels.map((item) => item.textContent)).toEqual([
      "Small",
      "Medium",
      "Large",
    ]);
    // Level 3 is the default, and it is what the folio has always rendered
    // at — the option has to open already showing that.
    expect(levels[2]?.getAttribute("aria-checked")).toBe("true");
    expect(alepha.store.get(folioTextSizeAtom).level).toBe(3);
  });

  it("stores the level the reader picks", async ({ expect }) => {
    const alepha = await mount();

    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Small" }),
    );

    expect(alepha.store.get(folioTextSizeAtom).level).toBe(1);
  });

  it("is inert with no folio open", async ({ expect }) => {
    // The lesson `view.inspector` writes down one entry above: a preference
    // control with no visible effect is worse than an absent one. At
    // `/folios` there is no document to resize.
    await mount({ ...anOpenFolio, noFolio: true });

    const levels = await screen.findAllByRole("menuitemradio");
    expect(levels.map((item) => item.getAttribute("aria-disabled"))).toEqual([
      "true",
      "true",
      "true",
    ]);
  });
});
