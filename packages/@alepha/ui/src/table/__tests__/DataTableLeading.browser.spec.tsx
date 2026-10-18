import { render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type { DataTableFilterFields } from "../dataTableTypes.ts";

interface Row {
  id: number;
  name: string;
}

const columns = {
  name: { label: "Name", cell: (r: Row) => r.name },
};

const rows: Row[] = [{ id: 1, name: "Camille" }];

const filterFields = {
  search: { preset: "search" },
} satisfies DataTableFilterFields;

/**
 * Whether `a` comes before `b` in document order.
 */
const precedes = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * `leading`: a section title drawn at the start of the toolbar's row, before
 * the search, rather than above the bar as `header` is.
 */
describe("DataTable leading", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
  });

  const mount = async (ui: ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Camille")).toBeTruthy());
  };

  it("opens the toolbar's row, before the search", async () => {
    await mount(
      <DataTable<Row, typeof filterFields>
        data={rows}
        columns={columns}
        filters={{ fields: filterFields }}
        leading={<span>Equipment</span>}
      />,
    );

    const title = screen.getByText("Equipment");
    const search = screen.getByRole("textbox");
    expect(precedes(title, search)).toBe(true);
    // On the row itself: the search's bar holds the title too.
    const bar = search.closest("form")?.parentElement;
    expect(bar?.contains(title)).toBe(true);
  });

  it("draws a toolbar on its own", async () => {
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        hideColumnPicker
        hideActionsMenu
        leading={<span>Equipment</span>}
      />,
    );

    expect(screen.getByText("Equipment")).toBeTruthy();
  });

  it("stays before the filter dialog's button on a phone", async () => {
    const matchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    try {
      await mount(
        <DataTable<Row, typeof filterFields>
          data={rows}
          columns={columns}
          filters={{ fields: filterFields }}
          leading={<span>Equipment</span>}
        />,
      );

      const title = screen.getByText("Equipment");
      const filters = await screen.findByRole("button", { name: "Filters" });
      expect(precedes(title, filters)).toBe(true);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: matchMedia,
      });
    }
  });
});
