import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", sortable: true, cell: (r: Row) => r.title },
};

/**
 * AlephaTable's static-data mode: `data` instead of `fetch`.
 *
 * The contract that matters is that a table fed an array behaves like a
 * table fed a fetcher — paging, sorting and the empty state all keep
 * working — and that it tracks the array it was given, which is the one
 * thing a `fetch`-shaped adapter around an in-memory list cannot do.
 */
describe("AlephaTable (static data)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  it("renders rows from `data` with no fetcher", async () => {
    await mount(
      <AlephaTable<Row>
        data={[
          { id: 1, title: "Alpha" },
          { id: 2, title: "Beta" },
        ]}
        columns={columns}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("tracks a changed data array", async () => {
    // The reason this is a prop and not a `fetch`-shaped wrapper: the table
    // holds its fetcher in a ref that is deliberately NOT a dependency of
    // its load effect, so a closure over an in-memory array goes stale the
    // moment the caller mutates it. Detaching a row must not leave the row
    // on screen.
    const { rerender } = await mount(
      <AlephaTable<Row>
        data={[
          { id: 1, title: "Alpha" },
          { id: 2, title: "Beta" },
        ]}
        columns={columns}
      />,
    );
    await waitFor(() => expect(screen.getByText("Beta")).toBeTruthy());

    rerender(
      <AlephaContext.Provider value={alepha!}>
        <AlephaTable<Row>
          data={[{ id: 1, title: "Alpha" }]}
          columns={columns}
        />
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(screen.queryByText("Beta")).toBeNull());
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("pages static data", async () => {
    await mount(
      <AlephaTable<Row>
        data={[
          { id: 1, title: "Alpha" },
          { id: 2, title: "Beta" },
          { id: 3, title: "Gamma" },
        ]}
        columns={columns}
        defaultSize={2}
        // Hides the size picker, whose trigger also reads "2" and would
        // make the pager link below ambiguous.
        pageSizes={[]}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(screen.queryByText("Gamma")).toBeNull();

    fireEvent.click(screen.getByText("2"));

    await waitFor(() => expect(screen.getByText("Gamma")).toBeTruthy());
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("sorts static data from the column header", async () => {
    await mount(
      <AlephaTable<Row>
        data={[
          { id: 1, title: "Beta" },
          { id: 2, title: "Alpha" },
        ]}
        columns={columns}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    fireEvent.click(screen.getByText("Title"));

    await waitFor(() => {
      const cells = screen.getAllByText(/Alpha|Beta/);
      expect(cells[0].textContent).toBe("Alpha");
    });
  });

  it("steps back when the data shrinks out from under the current page", async () => {
    // Rows vanish under the reader in static mode: the caller detaches one
    // and the page they are on stops existing. Nothing fetches, so nothing
    // else would notice — the table would sit on an empty page with no
    // visible cause.
    const four: Row[] = [
      { id: 1, title: "Alpha" },
      { id: 2, title: "Beta" },
      { id: 3, title: "Gamma" },
      { id: 4, title: "Delta" },
    ];
    const { rerender } = await mount(
      <AlephaTable<Row>
        data={four}
        columns={columns}
        defaultSize={2}
        pageSizes={[]}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    fireEvent.click(screen.getByText("2"));
    await waitFor(() => expect(screen.getByText("Gamma")).toBeTruthy());

    rerender(
      <AlephaContext.Provider value={alepha!}>
        <AlephaTable<Row>
          data={four.slice(0, 2)}
          columns={columns}
          defaultSize={2}
          pageSizes={[]}
        />
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(screen.queryByText("Gamma")).toBeNull();
  });

  it("renders the empty state for an empty array", async () => {
    await mount(
      <AlephaTable<Row>
        data={[]}
        columns={columns}
        emptyMessage="Nothing attached"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Nothing attached")).toBeTruthy(),
    );
  });
});
