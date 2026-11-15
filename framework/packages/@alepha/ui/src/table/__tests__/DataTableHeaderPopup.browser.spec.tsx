import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type {
  DataTableFilterFields,
  DataTableFilterValues,
} from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
  status: string;
  owner: string;
  price: number;
  created: string;
  notes: string;
}

const columns = {
  title: { label: "Title", sortable: true, cell: (r: Row) => r.title },
  status: { label: "Status", sortable: true, cell: (r: Row) => r.status },
  owner: { label: "Owner", cell: (r: Row) => r.owner },
  price: { label: "Price", sortable: true, cell: (r: Row) => r.price },
  created: { label: "Created", cell: (r: Row) => r.created },
  notes: { label: "Notes", cell: (r: Row) => r.notes },
};

const filterFields = {
  search: { preset: "search" },
  statuses: {
    schema: z.array(z.enum(["open", "closed"])),
    label: "Status",
    column: "status",
    items: [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ],
  },
  owner: { schema: z.string(), label: "Owner", column: "owner" },
  priceMin: {
    schema: z.number(),
    label: "Price",
    column: "price",
    range: "min",
    cents: true,
  },
  priceMax: {
    schema: z.number(),
    label: "Price",
    column: "price",
    range: "max",
    cents: true,
  },
  createdMin: {
    schema: z.date(),
    label: "Created",
    column: "created",
    range: "min",
  },
  createdMax: {
    schema: z.date(),
    label: "Created",
    column: "created",
    range: "max",
  },
} satisfies DataTableFilterFields;

type Filters = DataTableFilterValues<typeof filterFields>;

/**
 * `headerPopup`: a column's name and chevron open one popup holding its sort
 * entries, its filter drawn in place and « Reset ».
 */
describe("DataTable headerPopup", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
  });

  const mount = async (headerPopup = true) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const seen: Array<{ filters?: Filters; sort?: string }> = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row, typeof filterFields>
          columns={columns}
          headerPopup={headerPopup}
          filters={{ fields: filterFields }}
          fetch={async ({ filters, sort }) => {
            seen.push({ filters: { ...filters }, sort });
            return {
              content: [
                {
                  id: 1,
                  title: "Alpha",
                  status: "open",
                  owner: "Ada",
                  price: 1250,
                  created: "2026-01-01",
                  notes: "-",
                },
              ],
              page: {
                number: 0,
                size: 20,
                offset: 0,
                numberOfElements: 1,
                totalElements: 1,
                totalPages: 1,
                isEmpty: false,
                isFirst: true,
                isLast: true,
              },
            };
          }}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    return { last: () => seen.at(-1) };
  };

  const header = (column: string) =>
    document.querySelector<HTMLElement>(
      `[data-column="${column}"] [data-header-popup]`,
    );
  const chevron = (column: string) =>
    document.querySelector(`[data-column="${column}"] [data-header-chevron]`);
  const open = async (column: string) => {
    fireEvent.click(header(column)!);
    await waitFor(() =>
      expect(
        document.querySelector("[data-header-popup-content]"),
      ).toBeTruthy(),
    );
  };

  it("draws a chevron on filtered columns only, and no funnel or sort glyph", async () => {
    await mount();
    expect(chevron("status")).toBeTruthy();
    expect(chevron("price")).toBeTruthy();
    // Sortable, no filter: a popup with the sort alone, no chevron.
    expect(header("title")).toBeTruthy();
    expect(chevron("title")).toBeNull();
    // Neither: a plain label.
    expect(header("notes")).toBeNull();
    expect(document.querySelector("[data-header-filter]")).toBeNull();
  });

  it("sorts from the popup, ticks the order in force, and removes it when chosen again", async () => {
    const { last } = await mount();
    await open("status");
    fireEvent.click(document.querySelector('[data-header-sort="desc"]')!);
    await waitFor(() => expect(last()?.sort).toBe("-status"));

    await open("status");
    expect(
      document
        .querySelector('[data-header-sort="desc"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(document.querySelector('[data-header-sort="desc"]')!);
    await waitFor(() => expect(last()?.sort).toBeUndefined());
  });

  it("ticks list values, turns the chevron to the accent, and Reset empties the filter only", async () => {
    const { last } = await mount();
    await open("status");
    fireEvent.click(document.querySelector('[data-header-sort="asc"]')!);
    await waitFor(() => expect(last()?.sort).toBe("status"));

    await open("status");
    fireEvent.click(screen.getByRole("checkbox", { name: "Open" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Closed" }));
    await waitFor(() =>
      expect(last()?.filters?.statuses).toEqual(["open", "closed"]),
    );
    expect(chevron("status")?.hasAttribute("data-active")).toBe(true);
    // Never drawn on the bar.
    expect(document.querySelector('[data-filter="statuses"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(last()?.filters?.statuses).toBeUndefined());
    expect(last()?.sort).toBe("status");
    expect(chevron("status")?.hasAttribute("data-active")).toBe(false);
  });

  it("types an open number range in units and sends cents", async () => {
    const { last } = await mount();
    await open("price");
    fireEvent.change(
      document.querySelector<HTMLInputElement>('[data-header-range="min"]')!,
      { target: { value: "12.5" } },
    );
    await waitFor(() => expect(last()?.filters?.priceMin).toBe(1250));
    expect(last()?.filters?.priceMax).toBeUndefined();
  });

  it("types an open date range", async () => {
    const { last } = await mount();
    await open("created");
    fireEvent.change(
      document.querySelector<HTMLInputElement>('[data-header-range="max"]')!,
      { target: { value: "2026-02-01" } },
    );
    await waitFor(() => expect(last()?.filters?.createdMax).toBe("2026-02-01"));
    expect(last()?.filters?.createdMin).toBeUndefined();
  });

  it("filters a text column with one box", async () => {
    const { last } = await mount();
    await open("owner");
    fireEvent.change(screen.getByRole("textbox", { name: "Owner" }), {
      target: { value: "ad" },
    });
    await waitFor(() => expect(last()?.filters?.owner).toBe("ad"));
  });

  it("keeps today's header without the option", async () => {
    await mount(false);
    expect(document.querySelector("[data-header-popup]")).toBeNull();
    expect(
      document.querySelector('[data-header-filter="statuses"]'),
    ).toBeTruthy();
  });
});
