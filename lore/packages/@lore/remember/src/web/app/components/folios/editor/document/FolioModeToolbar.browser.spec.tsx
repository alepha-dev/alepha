import { I18n } from "@lore/core/web";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import FolioModeToolbar from "./FolioModeToolbar.tsx";

/**
 * The folio document's toolbar (#Q3653): Edit, View and Both as one
 * segmented control.
 */
describe("FolioModeToolbar", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  it("offers Edit, View and Both, marks the current one, and reports a pick", async ({
    expect,
  }) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const picked: string[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <FolioModeToolbar mode="view" onChange={(mode) => picked.push(mode)} />
      </AlephaContext.Provider>,
    );

    // Three icons (#Q3692), each named and tooltipped by its old label.
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Edit",
      "View",
      "Both",
    ]);
    expect(radios.map((radio) => radio.getAttribute("title"))).toEqual([
      "Edit",
      "View",
      "Both",
    ]);
    expect(radios.every((radio) => radio.querySelector("svg"))).toBe(true);
    expect(radios.map((radio) => radio.textContent)).toEqual(["", "", ""]);
    expect(screen.getByTestId("folio-mode").dataset.mode).toBe("view");
    expect(
      screen.getByRole("radio", { name: "View" }).getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    expect(picked).toEqual(["both"]);
  });
});
