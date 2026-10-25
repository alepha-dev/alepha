import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, type Page } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Highlight } from "../../core/Highlight.tsx";
import { DataTable } from "../DataTable.tsx";
import type {
  ColumnDef,
  DataTableFilterFields,
  DataTableFilterValues,
} from "../dataTableTypes.ts";

interface Row {
  id: number;
  name: string;
}

const rows: Row[] = [
  { id: 1, name: "Camille Martin" },
  { id: 2, name: "Hugo Thomas" },
];

const filterFields = {
  search: { preset: "search" },
} satisfies DataTableFilterFields;

const columns: Record<string, ColumnDef<Row>> = {
  name: {
    label: "Name",
    cell: (row, ctx) => <Highlight text={row.name} query={ctx?.search} />,
  },
};

const page = (content: Row[]): Page<Row> => ({
  content,
  page: {
    number: 0,
    size: content.length,
    offset: 0,
    numberOfElements: content.length,
    totalElements: content.length,
    totalPages: 1,
    isEmpty: content.length === 0,
    isFirst: true,
    isLast: true,
  },
});

/**
 * Every cell is told the table's search, so a column can mark what it
 * matched with `<Highlight>` (#Q2407).
 */
describe("DataTable (the search handed to cells)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const start = async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const marks = () =>
    [...document.querySelectorAll('[data-slot="highlight"]')].map(
      (mark) => mark.textContent,
    );

  it("marks the search in static rows", async () => {
    const app = await start();
    render(
      <AlephaContext.Provider value={app}>
        <DataTable<Row, typeof filterFields>
          data={rows}
          columns={columns}
          filters={{ fields: filterFields }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() =>
      expect(screen.getByText("Camille Martin")).toBeTruthy(),
    );
    expect(marks()).toEqual([]);

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "cam" },
    });

    await waitFor(() => expect(marks()).toEqual(["Cam"]));
  });

  it("marks the search the fetched rows answer", async () => {
    const app = await start();
    const fetch = async (params: {
      filters?: DataTableFilterValues<typeof filterFields>;
    }) => {
      const q = params.filters?.search?.toLowerCase() ?? "";
      return page(rows.filter((row) => row.name.toLowerCase().includes(q)));
    };
    render(
      <AlephaContext.Provider value={app}>
        <DataTable<Row, typeof filterFields>
          fetch={fetch}
          columns={columns}
          filters={{ fields: filterFields }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Hugo Thomas")).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "thom" },
    });

    await waitFor(() => expect(marks()).toEqual(["Thom"]));
    expect(screen.queryByText("Camille Martin")).toBeNull();
  });
});
