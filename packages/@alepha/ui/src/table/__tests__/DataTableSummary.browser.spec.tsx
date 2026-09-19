import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha, AlephaError } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type {
  DataTableFilterFields,
  DataTableFilterValues,
  DataTableStatCard,
} from "../dataTableTypes.ts";

interface Row {
  id: number;
  name: string;
}

const columns = {
  name: { label: "Name", cell: (r: Row) => r.name },
};

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  name: i % 2 === 0 ? `Camille ${i + 1}` : `Hugo ${i + 1}`,
}));

const filterFields = {
  search: { preset: "search" },
} satisfies DataTableFilterFields;

type Filters = DataTableFilterValues<typeof filterFields>;

const matching = (filters: Filters | undefined) => {
  const q = filters?.search?.toLowerCase() ?? "";
  return rows.filter((row) => row.name.toLowerCase().includes(q));
};

const pageOf = (all: Row[], page = 0, size = 10) => {
  const content = all.slice(page * size, page * size + size);
  const totalPages = Math.max(1, Math.ceil(all.length / size));
  return {
    content,
    page: {
      number: page,
      size,
      offset: page * size,
      numberOfElements: content.length,
      totalElements: all.length,
      totalPages,
      isEmpty: content.length === 0,
      isFirst: page === 0,
      isLast: page >= totalPages - 1,
    },
  };
};

/**
 * The summary panel at the top of a DataTable (#Q2409): stat cards, given or
 * fetched with the table's filters, in a band the reader can collapse.
 */
describe("DataTable summary panel", () => {
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
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  const panel = () => screen.getByRole("region", { name: "Summary" });
  const toggle = () => within(panel()).getByRole("button", { name: "Summary" });

  /**
   * Each tile as `label=value`, read from the `<dl>` the panel draws.
   */
  const tiles = () =>
    [...panel().querySelectorAll('[data-slot="data-table-stat"]')].map(
      (tile) =>
        `${tile.querySelector("dt")?.textContent}=${tile.querySelector("dd")?.textContent}`,
    );

  it("draws given cards, open by default, as terms and figures", async () => {
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        summary={{
          cards: [
            { label: "Members", value: "30", hint: "Across every team" },
            { label: "Active", value: "12", tone: "success" },
          ],
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Camille 1")).toBeTruthy());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(tiles()).toEqual(["Members=30", "Active=12"]);
    expect(within(panel()).getByText("Across every team")).toBeTruthy();
    expect(
      panel().querySelector('[data-tone="success"]')?.querySelector("dt")
        ?.textContent,
    ).toBe("Active");
  });

  it("collapses, and remembers it under the persistence key", async () => {
    const view = await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        persistenceKey="probe"
        summary={{ cards: [{ label: "Members", value: "30" }] }}
      />,
    );
    await waitFor(() => expect(tiles()).toEqual(["Members=30"]));

    fireEvent.click(toggle());

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(tiles()).toEqual([]);
    expect(window.localStorage.getItem("probe.summaryOpen")).toBe("false");

    // A new visit opens it closed, and the toggle is still there to open it.
    view.unmount();
    await alepha?.stop();
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        persistenceKey="probe"
        summary={{ cards: [{ label: "Members", value: "30" }] }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Camille 1")).toBeTruthy());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(tiles()).toEqual([]);

    fireEvent.click(toggle());
    expect(tiles()).toEqual(["Members=30"]);
    expect(window.localStorage.getItem("probe.summaryOpen")).toBe("true");
  });

  it("fetches its cards with the filters, and again when they change", async () => {
    const seen: Array<Filters | undefined> = [];
    await mount(
      <DataTable<Row, typeof filterFields>
        fetch={async ({ filters, page, size }) =>
          pageOf(matching(filters), page, size)
        }
        defaultSize={10}
        columns={columns}
        filters={{ fields: filterFields }}
        summary={{
          fetch: async ({ filters }) => {
            seen.push(filters);
            return [
              { label: "Matching", value: String(matching(filters).length) },
            ];
          },
        }}
      />,
    );

    await waitFor(() => expect(tiles()).toEqual(["Matching=30"]));

    fireEvent.change(screen.getByPlaceholderText("Search"), {
      target: { value: "hugo" },
    });

    // The set, not the page: 15 Hugos across two pages of ten.
    await waitFor(() => expect(tiles()).toEqual(["Matching=15"]));
    expect(seen.at(-1)?.search).toBe("hugo");
  });

  it("reloads with the table, and not with the page", async () => {
    let calls = 0;
    await mount(
      <DataTable<Row>
        fetch={async ({ page, size }) => pageOf(rows, page, size)}
        defaultSize={10}
        columns={columns}
        summary={{
          fetch: async () => {
            calls++;
            return [{ label: "Loads", value: String(calls) }];
          },
        }}
      />,
    );
    await waitFor(() => expect(tiles()).toEqual(["Loads=1"]));

    // A page shows other rows of the same set: the figures stand.
    fireEvent.click(screen.getByLabelText("Go to next page"));
    await waitFor(() => expect(screen.getByText("Camille 11")).toBeTruthy());
    expect(calls).toBe(1);

    // Refresh reloads the set, and the figures with it.
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(tiles()).toEqual(["Loads=2"]));
  });

  it("stands placeholders in while the first fetch is out", async () => {
    let resolve: (cards: DataTableStatCard[]) => void = () => {};
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        summary={{
          fetch: () =>
            new Promise<DataTableStatCard[]>((r) => {
              resolve = r;
            }),
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Camille 1")).toBeTruthy());
    const body = panel().querySelector("[aria-busy]");
    expect(body?.getAttribute("aria-busy")).toBe("true");
    expect(panel().querySelectorAll('[data-slot="skeleton"]').length).toBe(4);
    expect(tiles()).toEqual([]);

    resolve([{ label: "Members", value: "30" }]);

    await waitFor(() => expect(tiles()).toEqual(["Members=30"]));
    expect(panel().querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
    expect(body?.getAttribute("aria-busy")).toBe("false");
  });

  it("does not fetch while collapsed, and fetches on opening", async () => {
    window.localStorage.setItem("probe.summaryOpen", "false");
    let calls = 0;
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        persistenceKey="probe"
        summary={{
          fetch: async () => {
            calls++;
            return [{ label: "Members", value: "30" }];
          },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Camille 1")).toBeTruthy());
    expect(calls).toBe(0);

    fireEvent.click(toggle());

    await waitFor(() => expect(tiles()).toEqual(["Members=30"]));
    expect(calls).toBe(1);
  });

  it("draws a node alone, or after the cards", async () => {
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        summary={{
          cards: [{ label: "Members", value: "30" }],
          content: <p>Counted every night.</p>,
        }}
      />,
    );

    await waitFor(() => expect(tiles()).toEqual(["Members=30"]));
    const note = within(panel()).getByText("Counted every night.");
    const grid = panel().querySelector("dl") as HTMLElement;
    // After the cards, in document order.
    expect(
      grid.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is not drawn with nothing to show", async () => {
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        summary={{ fetch: async () => [] }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Camille 1")).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Summary" })).toBeNull(),
    );
  });

  it("reports a failed fetch, and does not stand placeholders in for it", async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    // Subscribed before the render: the rejection lands in a microtask of
    // the first effect, ahead of anything after `render` returns.
    const reported: string[] = [];
    alepha.events.on("react:action:error", (event) => {
      reported.push(event.error.message);
    });
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row>
          data={rows}
          columns={columns}
          summary={{
            fetch: async () => {
              throw new AlephaError("stats are down");
            },
          }}
        />
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(reported).toEqual(["stats are down"]));
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
  });

  it("flags a failure its onError handles, so no toast repeats it", async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const events: Array<{ message: string; handled?: boolean }> = [];
    alepha.events.on("react:action:error", (event) => {
      events.push({ message: event.error.message, handled: event.handled });
    });
    const handled: string[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row>
          data={rows}
          columns={columns}
          summary={{
            fetch: async () => {
              throw new AlephaError("stats are down");
            },
            onError: (error) => handled.push(error.message),
          }}
        />
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(handled).toEqual(["stats are down"]));
    // Still emitted, for error reporting; flagged for the toaster.
    expect(events).toEqual([{ message: "stats are down", handled: true }]);
  });

  it("takes the caller's title", async () => {
    await mount(
      <DataTable<Row>
        data={rows}
        columns={columns}
        summary={{
          title: "This month",
          cards: [{ label: "Members", value: "30" }],
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("Camille 1")).toBeTruthy());
    const region = screen.getByRole("region", { name: "This month" });
    expect(
      within(region).getByRole("button", { name: "This month" }),
    ).toBeTruthy();
  });
});
