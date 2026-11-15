import { I18n, spotlightOpenAtom } from "@lore/core/web";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import FolioRootPrompt from "./FolioRootPrompt.tsx";

/**
 * `/folios` with nothing chosen (#Q3655): New folio for a writer, Search
 * folios for everyone, and no listing of the root.
 */
describe("FolioRootPrompt", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (onCreateFolio?: () => void) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <FolioRootPrompt onCreateFolio={onCreateFolio} />
      </AlephaContext.Provider>,
    );
    return alepha;
  };

  it("offers New folio to a writer and opens the create page", async ({
    expect,
  }) => {
    let created = 0;
    await mount(() => {
      created += 1;
    });

    fireEvent.click(screen.getByRole("button", { name: "New folio" }));
    expect(created).toBe(1);
  });

  it("opens the search palette from Search folios, and offers no New folio to a reader", async ({
    expect,
  }) => {
    const app = await mount();

    expect(screen.queryByRole("button", { name: "New folio" })).toBeNull();
    expect(app.store.get(spotlightOpenAtom).open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Search folios" }));
    expect(app.store.get(spotlightOpenAtom).open).toBe(true);
  });
});
