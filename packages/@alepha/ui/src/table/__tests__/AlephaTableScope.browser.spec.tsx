import { render, screen, waitFor } from "@testing-library/react";
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
  extra: { label: "Extra", defaultHidden: true, cell: () => "x" },
};

const pageOf = (rows: Row[]) => ({
  content: rows,
  page: {
    number: 0,
    size: 20,
    offset: 0,
    numberOfElements: rows.length,
    totalElements: rows.length,
    totalPages: 1,
    isEmpty: rows.length === 0,
    isFirst: true,
    isLast: true,
  },
});

/**
 * A changed `persistenceKey` is a changed SCOPE.
 *
 * Every project-scoped table in Lore encodes its project in that key. Nothing
 * acted on a change to it, and `load` re-runs only on
 * `[page, size, sortParam, refreshKey, form, alepha]` - none of which a
 * project switch touches - while the router does not remount on a param-only
 * navigation. So the table kept serving the previous project's rows under the
 * new project's name (feedback #2096).
 */
describe("AlephaTable (persistenceKey as scope)", () => {
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
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  const table = (key: string, onFetch: (key: string) => void) => (
    <AlephaTable<Row>
      persistenceKey={key}
      columns={columns}
      fetch={async () => {
        onFetch(key);
        return pageOf([{ id: 1, title: `row of ${key}` }]);
      }}
    />
  );

  it("refetches when the key changes, even with identical stored prefs", async () => {
    // ⚠️ The load-bearing case. Two projects that share a sort and a size
    // change no dependency of `load`, so nothing would refetch on the values
    // alone - which is the bug's whole mechanism. Neither key has anything
    // stored here, so both resolve to the same defaults.
    const seen: string[] = [];
    const { rerender } = await mount(table("proj.a", (k) => seen.push(k)));

    await waitFor(() => expect(screen.getByText("row of proj.a")).toBeTruthy());

    rerender(
      <AlephaContext.Provider value={alepha!}>
        {table("proj.b", (k) => seen.push(k))}
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("row of proj.b")).toBeTruthy());
    expect(seen).toContain("proj.b");
    // And the outgoing project's rows are gone, rather than sitting under the
    // new project's name.
    expect(screen.queryByText("row of proj.a")).toBeNull();
  });

  it("reads the incoming key's stored sort instead of writing the outgoing one's over it", async () => {
    // What each project saved on its own last visit.
    window.localStorage.setItem(
      "proj.a.sort",
      JSON.stringify({ field: "title", direction: "asc" }),
    );
    window.localStorage.setItem(
      "proj.b.sort",
      JSON.stringify({ field: "title", direction: "desc" }),
    );

    const { rerender } = await mount(table("proj.a", () => {}));
    await waitFor(() => expect(screen.getByText("row of proj.a")).toBeTruthy());

    rerender(
      <AlephaContext.Provider value={alepha!}>
        {table("proj.b", () => {})}
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("row of proj.b")).toBeTruthy());

    // ⚠️ B keeps its own descending sort. The persist effects are keyed on
    // `persistenceKey` too, so before this fix they fired on the same render
    // and wrote A's ascending sort under B's key - silently replacing the
    // preferences of the project just opened with those of the one just left.
    expect(JSON.parse(window.localStorage.getItem("proj.b.sort")!)).toEqual({
      field: "title",
      direction: "desc",
    });
    // And A's own stored sort is untouched by having been left.
    expect(JSON.parse(window.localStorage.getItem("proj.a.sort")!)).toEqual({
      field: "title",
      direction: "asc",
    });
  });

  it("reads the incoming key's stored columns rather than carrying the outgoing set", async () => {
    // A shows only the title; B has opted the hidden column in.
    window.localStorage.setItem("proj.a.columns", JSON.stringify(["title"]));
    window.localStorage.setItem(
      "proj.b.columns",
      JSON.stringify(["title", "extra"]),
    );

    const { rerender } = await mount(table("proj.a", () => {}));
    await waitFor(() => expect(screen.getByText("row of proj.a")).toBeTruthy());
    expect(screen.queryByText("Extra")).toBeNull();

    rerender(
      <AlephaContext.Provider value={alepha!}>
        {table("proj.b", () => {})}
      </AlephaContext.Provider>,
    );

    // B's own column choice, read on arrival.
    await waitFor(() => expect(screen.getByText("Extra")).toBeTruthy());
    expect(JSON.parse(window.localStorage.getItem("proj.a.columns")!)).toEqual([
      "title",
    ]);
  });
});
