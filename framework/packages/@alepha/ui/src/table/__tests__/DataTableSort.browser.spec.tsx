import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type { SortState } from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const rows: Row[] = [
  { id: 1, title: "Alpha" },
  { id: 2, title: "Beta" },
];

const columns = {
  title: { label: "Title", sortable: true, cell: (r: Row) => r.title },
};

/**
 * The header's sort: stored only once the reader sorts, and reported once
 * per click.
 */
describe("DataTable (sort)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
  };

  it("stores nothing until the reader sorts", async () => {
    // Stored on mount, the default sort froze for everyone who merely opened
    // the table, so a later change of `defaultSort` never reached them.
    await mount(
      <DataTable<Row>
        persistenceKey="probe"
        defaultSort={{ field: "title", direction: "desc" }}
        data={rows}
        columns={columns}
      />,
    );
    expect(window.localStorage.getItem("probe.sort")).toBeNull();

    // From the default descending sort the header clears it, then sorts
    // ascending, which is stored.
    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    expect(JSON.parse(window.localStorage.getItem("probe.sort")!)).toEqual({
      field: "title",
      direction: "asc",
    });
  });

  it("reports one header click once under StrictMode", async () => {
    const seen: Array<SortState | null> = [];
    await mount(
      <StrictMode>
        <DataTable<Row>
          data={rows}
          columns={columns}
          onSortChange={(next) => seen.push(next)}
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Title/ }));
    expect(seen).toEqual([{ field: "title", direction: "asc" }]);
  });
});
