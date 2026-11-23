import { I18n } from "@lore/core/web";
import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import RunResultNote from "./RunResultNote.tsx";

/**
 * A failed criterion's evidence, for a person first (#Q4210).
 */
describe("RunResultNote", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (note: string) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <RunResultNote note={note} failed />
      </AlephaContext.Provider>,
    );
    return screen.getByTestId("run-evidence");
  };

  it("shows Expected, Seen and Also as labelled rows, and folds the developer's details", async ({
    expect,
  }) => {
    await mount(
      [
        "Expected: choosing a region narrows every chart.",
        "**Seen:** only `Orders` narrows;",
        "the rest stays network-wide.",
        "- Also: the picker offers no store.",
        "Details (for the developer): page `/overview`, region north.",
        "Repro: Overview, then Region = north.",
      ].join("\n"),
    );

    const labels = [...document.querySelectorAll("dt")].map((dt) =>
      dt.getAttribute("data-label"),
    );
    expect(labels).toEqual(["expected", "seen", "also"]);
    expect(
      [...document.querySelectorAll("dt")].map((dt) => dt.textContent),
    ).toEqual(["Expected", "Seen", "Also"]);
    const rows = [...document.querySelectorAll("dd")];
    expect(rows[1].textContent).toContain("the rest stays network-wide.");
    expect(rows[1].querySelector("code")?.textContent).toBe("Orders");

    const details = screen.getByTestId(
      "run-evidence-details",
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Details (for the developer)");
    expect(details.textContent).toContain("Repro: Overview");
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
  });

  it("keeps a free-text note as the Markdown it is", async ({ expect }) => {
    const evidence = await mount(
      "No mail after `POST /orders` returned **201**",
    );

    expect(screen.queryByTestId("run-evidence-rows")).toBeNull();
    expect(screen.queryByTestId("run-evidence-details")).toBeNull();
    expect(evidence.querySelector("code")?.textContent).toBe("POST /orders");
    expect(evidence.querySelector("strong")?.textContent).toBe("201");
  });
});
