import { render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { uiFr } from "../../i18n/fr/uiFr.ts";
import { DataTable } from "../DataTable.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * 2,250 rows, so the footer has three things to say in a language: the page
 * line, a number with a thousands separator, and the page links.
 */
const rows: Row[] = Array.from({ length: 2250 }, (_, i) => ({
  id: i + 1,
  title: `Row ${i + 1}`,
}));

/**
 * The footer under every table is in the page's language (#Q2392).
 *
 * It was a template literal, `Page 1 of 113 · 20 of 2250`, with "Previous"
 * and "Next" from the pagination primitive's English defaults, under a table
 * whose every other word was French.
 */
describe("DataTable footer follows the i18n language", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  class Catalogues {
    en = $dictionary({ lazy: async () => ({ default: {} }) });
    // The real catalogue, so a key renamed on one side only goes red here.
    fr = $dictionary({ lazy: async () => ({ default: uiFr }) });
  }

  const mount = async (lang: "en" | "fr") => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    alepha.inject(Catalogues);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row> data={rows} columns={columns} />
      </AlephaContext.Provider>,
    );
  };

  /**
   * `Intl` separates French thousands with a narrow no-break space. Folded
   * to a plain space so the assertion reads like the page does.
   */
  const text = (el: HTMLElement) =>
    (el.textContent ?? "").replace(/[  ]/g, " ");

  it("reads the page line, the counts and the links in French", async () => {
    await mount("fr");

    const line = await waitFor(() => screen.getByText(/^Page 1 sur/));
    expect(text(line)).toBe("Page 1 sur 113 · 20 sur 2 250");
    expect(screen.getByText("Précédent")).toBeTruthy();
    expect(screen.getByText("Suivant")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy();
    // By label rather than role: the primitive draws its links as buttons.
    expect(screen.getByLabelText("Aller à la page suivante")).toBeTruthy();
    expect(screen.getAllByText("Autres pages").length).toBeGreaterThan(0);
  });

  it("keeps the English line without a catalogue", async () => {
    await mount("en");

    const line = await waitFor(() => screen.getByText(/^Page 1 of/));
    expect(text(line)).toBe("Page 1 of 113 · 20 of 2,250");
    expect(screen.getByText("Previous")).toBeTruthy();
    expect(screen.getByLabelText("Go to next page")).toBeTruthy();
  });
});
