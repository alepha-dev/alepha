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
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
  status: { label: "Status", cell: (r: Row) => r.status },
  owner: { label: "Owner", cell: (r: Row) => r.owner },
  reviewer: { label: "Reviewer", cell: () => "-" },
};

const filterFields = {
  search: { preset: "search" },
  status: {
    schema: z.enum(["open", "closed"]),
    label: "Status",
    column: "status",
    operators: "is",
    items: [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ],
  },
  owner: { schema: z.string(), label: "Owner", column: "owner" },
  // A string whose options the server searches: a user picker (#Q3432).
  reviewer: {
    schema: z.string(),
    label: "Reviewer",
    column: "reviewer",
    control: {
      loaderThreshold: 0,
      items: async (search: string) =>
        [
          { value: "u-1", label: "ada@example.com" },
          { value: "u-2", label: "bob@example.com" },
        ].filter((u) => u.label.includes(search)),
    },
  },
} satisfies DataTableFilterFields;

type Filters = DataTableFilterValues<typeof filterFields>;

/**
 * The funnel a filter's `column` puts in that column's header: it opens the
 * filter in place, a set filter still shows on the bar, and a filter emptied
 * from its header leaves the bar again.
 */
describe("DataTableHeaderFilter", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
  });

  const mount = async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const seen: Array<Filters | undefined> = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row, typeof filterFields>
          columns={columns}
          filters={{ fields: filterFields }}
          fetch={async ({ filters }) => {
            seen.push({ ...filters });
            return {
              content: [
                { id: 1, title: "Alpha", status: "open", owner: "Ada" },
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

  const funnel = (key: string) =>
    document.querySelector<HTMLElement>(`[data-header-filter="${key}"]`);
  const slot = (key: string) =>
    document.querySelector(`[data-filter="${key}"]`);

  /**
   * Opens the Status funnel's list and picks `name`.
   */
  const pick = async (name: string) => {
    fireEvent.keyDown(funnel("status")!, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name }));
  };

  it("draws a dim funnel on the columns a filter names, and on no other", async () => {
    await mount();

    expect(funnel("status")).toBeTruthy();
    expect(funnel("owner")).toBeTruthy();
    expect(funnel("title")).toBeNull();
    expect(funnel("status")!.hasAttribute("data-active")).toBe(false);
    // A combobox, not a button: the funnel IS the list's trigger.
    expect(
      screen.getByRole("combobox", { name: "Filter: Status" }),
    ).toBeTruthy();
  });

  it("opens a string filter with a control.items loader as a list, and filters by the value (#Q3432)", async () => {
    const table = await mount();

    expect(
      screen.getByRole("combobox", { name: "Filter: Reviewer" }),
    ).toBeTruthy();
    fireEvent.keyDown(funnel("reviewer")!, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "bob@example.com" }));

    await waitFor(() => expect(table.last()?.reviewer).toBe("u-2"));
  });

  it("filters from the header, lights the funnel, and still shows the filter on the bar", async () => {
    const table = await mount();
    expect(slot("status")).toBeNull();

    await pick("Open");

    await waitFor(() => expect(table.last()?.status).toBe("open"));
    expect(funnel("status")!.hasAttribute("data-active")).toBe(true);
    await waitFor(() => expect(slot("status")).toBeTruthy());
  });

  it("takes a filter emptied from its header back off the bar", async () => {
    const table = await mount();
    await pick("Open");
    await waitFor(() => expect(slot("status")).toBeTruthy());

    // Pressing the selected row again deselects it, and the list closes.
    await pick("Open");

    await waitFor(() => expect(table.last()?.status).toBeUndefined());
    await waitFor(() => expect(slot("status")).toBeNull());
    expect(funnel("status")!.hasAttribute("data-active")).toBe(false);
  });

  it("opens a text filter's box in a popover", async () => {
    const table = await mount();

    fireEvent.click(funnel("owner")!);
    const box = await screen.findByRole("textbox", { name: "Owner" });
    fireEvent.change(box, { target: { value: "Ada" } });

    await waitFor(() => expect(table.last()?.owner).toBe("Ada"));
    expect(funnel("owner")!.hasAttribute("data-active")).toBe(true);
  });

  it("offers Filter in the column's context menu, and only there", async () => {
    await mount();

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /Title/ }));
    await screen.findByRole("menuitem", { name: /Hide column/ });
    expect(screen.queryByRole("menuitem", { name: "Filter" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    fireEvent.contextMenu(screen.getByRole("columnheader", { name: /Status/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Filter" }));

    expect(await screen.findByRole("option", { name: "Open" })).toBeTruthy();
  });
});
