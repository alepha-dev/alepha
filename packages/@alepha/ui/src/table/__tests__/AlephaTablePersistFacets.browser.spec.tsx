import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AlephaTablePersistedFacets } from "../alepha-table.tsx";
import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", sortable: true, cell: (r: Row) => r.title },
  extra: { label: "Extra", defaultHidden: true, cell: () => "x" },
};

const filtersSchema = z.object({
  search: z.string().optional(),
});

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
 * `persistenceKey` used to be one switch over three unlike preferences.
 *
 * Column layout and sort are what a reader arranged and expects to find
 * again; a filter is the question they asked last time, and restoring it
 * opens the page narrowed by an answer they already have. Lore's Apps list
 * had to give up persistence entirely over that - losing its hidden columns
 * to avoid a stale search - because the three could not be separated.
 *
 * The cases below pin both halves: what `persist` turns off, and that
 * everything an existing caller relies on is untouched when it is absent.
 */
describe("AlephaTable (per-facet persistence)", () => {
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

  /**
   * What a previous session left behind: a search, a descending sort, and a
   * column set that hides nothing the defaults would not already hide.
   */
  const seedAllThree = () => {
    window.localStorage.setItem(
      "probe.filters",
      JSON.stringify({ search: "stale" }),
    );
    window.localStorage.setItem(
      "probe.sort",
      JSON.stringify({ field: "title", direction: "desc" }),
    );
    window.localStorage.setItem(
      "probe.columns",
      JSON.stringify(["title", "extra"]),
    );
  };

  const table = (
    seen: Array<{ sort?: string; filters?: Record<string, any> }>,
    persist?: AlephaTablePersistedFacets,
  ) => (
    <AlephaTable<Row>
      persistenceKey="probe"
      {...(persist ? { persist } : {})}
      columns={columns}
      filters={{
        schema: filtersSchema,
        render: (form) => (
          <button
            type="button"
            onClick={() => (form.input as any).search.set("typed")}
          >
            set search
          </button>
        ),
      }}
      fetch={async ({ sort, filters }) => {
        seen.push({ sort, filters });
        return pageOf([{ id: 1, title: "Alpha" }]);
      }}
    />
  );

  it("restores all three when persist is absent", async () => {
    // ⚠️ The regression guard for every existing caller. Nothing in this
    // change may narrow what a bare `persistenceKey` does, and a default that
    // quietly dropped one facet would be a silent behaviour change across the
    // whole app.
    seedAllThree();
    const seen: Array<{ sort?: string; filters?: Record<string, any> }> = [];
    await mount(table(seen));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(seen[0]?.filters?.search).toBe("stale");
    expect(seen[0]?.sort).toBe("-title");
    // The stored set opted `extra` in, against its own `defaultHidden`.
    expect(screen.getByText("Extra")).toBeTruthy();
  });

  it("drops the stored filters when they are turned off, and keeps columns and sort", async () => {
    // The Apps page's case exactly: the layout is worth remembering, the
    // search is not.
    seedAllThree();
    const seen: Array<{ sort?: string; filters?: Record<string, any> }> = [];
    await mount(table(seen, { filters: false }));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(seen[0]?.filters?.search).toBeUndefined();
    // ...while the other two are untouched by their neighbour being off.
    expect(seen[0]?.sort).toBe("-title");
    expect(screen.getByText("Extra")).toBeTruthy();
  });

  it("still filters live with filters off, and writes nothing back", async () => {
    // Off means "do not remember", never "do not filter". A reader who types
    // gets the narrowed list they asked for; what they do not get is that
    // question asked again for them on their next visit.
    const seen: Array<{ sort?: string; filters?: Record<string, any> }> = [];
    await mount(table(seen, { filters: false }));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    fireEvent.click(screen.getByText("set search"));

    await waitFor(() =>
      expect(seen.some((call) => call.filters?.search === "typed")).toBe(true),
    );
    expect(window.localStorage.getItem("probe.filters")).toBeNull();
  });

  it("leaves a stored column set unread when columns are turned off", async () => {
    seedAllThree();
    const seen: Array<{ sort?: string; filters?: Record<string, any> }> = [];
    await mount(table(seen, { columns: false }));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    // Back to the column's own `defaultHidden`, rather than the reader's
    // stored opt-in.
    expect(screen.queryByText("Extra")).toBeNull();
    // And the facet that was not named is still on.
    expect(seen[0]?.filters?.search).toBe("stale");
  });
});
