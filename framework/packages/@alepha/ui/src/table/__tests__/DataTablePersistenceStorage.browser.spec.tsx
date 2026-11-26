import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import {
  type DataTablePersistenceStorage,
  localStorageDataTableStorage,
  readPersisted,
  writePersisted,
} from "../dataTablePersistence.ts";
import type { DataTableFilterFields } from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", sortable: true, cell: (r: Row) => r.title },
  extra: { label: "Extra", defaultHidden: true, cell: () => "x" },
};

const filterFields = {
  search: { preset: "search" },
} satisfies DataTableFilterFields;

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
 * A storage that is not `localStorage`: a plain map, the shape a store
 * loaded from a server takes once it answers from memory.
 */
const memoryStorage = (
  seed: Record<string, unknown> = {},
): DataTablePersistenceStorage & { values: Map<string, unknown> } => {
  const values = new Map<string, unknown>(Object.entries(seed));
  return {
    values,
    read: (key, suffix) => values.get(`${key}/${suffix}`),
    write: (key, suffix, value) => {
      if (value === undefined) values.delete(`${key}/${suffix}`);
      else values.set(`${key}/${suffix}`, value);
    },
  };
};

/**
 * `persistenceStorage` (#Q4417): where a table keeps what it remembers is a
 * storage it is handed, so the same state can live in a user's preferences
 * on a server rather than in one browser. `localStorage` stays the default.
 */
describe("DataTable (persistence storage)", () => {
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

  const table = (
    seen: Array<{ sort?: string; filters?: Record<string, any> }>,
    storage?: DataTablePersistenceStorage,
  ) => (
    <DataTable<Row, typeof filterFields>
      persistenceKey="probe"
      {...(storage ? { persistenceStorage: storage } : {})}
      columns={columns}
      filters={{
        fields: filterFields,
        render: (form) => (
          <button type="button" onClick={() => form.input.search.set("typed")}>
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

  it("restores filters, sort and columns from the storage it is given, on the first fetch", async () => {
    // What another device wrote: nothing in this browser's localStorage.
    const storage = memoryStorage({
      "probe/filters": { search: "elsewhere" },
      "probe/sort": { field: "title", direction: "desc" },
      "probe/columns": ["title", "extra"],
    });
    const seen: Array<{ sort?: string; filters?: Record<string, any> }> = [];
    await mount(table(seen, storage));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    // The very first request already carries them: no fetch with the
    // defaults went out before the stored state was applied.
    expect(seen[0]?.filters?.search).toBe("elsewhere");
    expect(seen[0]?.sort).toBe("-title");
    expect(screen.getByText("Extra")).toBeTruthy();
  });

  it("writes the reader's changes to that storage, and nothing to localStorage", async () => {
    const storage = memoryStorage();
    const seen: Array<{ sort?: string; filters?: Record<string, any> }> = [];
    await mount(table(seen, storage));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    fireEvent.click(screen.getByText("set search"));
    fireEvent.click(screen.getByRole("button", { name: /Title/ }));

    await waitFor(() =>
      expect(storage.values.get("probe/filters")).toEqual({ search: "typed" }),
    );
    expect(storage.values.get("probe/sort")).toEqual({
      field: "title",
      direction: "asc",
    });
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps localStorage as the default, under `<key>.<suffix>`", async () => {
    window.localStorage.setItem(
      "probe.sort",
      JSON.stringify({ field: "title", direction: "desc" }),
    );
    const seen: Array<{ sort?: string; filters?: Record<string, any> }> = [];
    await mount(table(seen));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(seen[0]?.sort).toBe("-title");
    fireEvent.click(screen.getByText("set search"));
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("probe.filters")!)).toEqual(
        {
          search: "typed",
        },
      ),
    );
  });
});

describe("readPersisted / writePersisted with a storage", () => {
  afterEach(() => window.localStorage.clear());

  it("turns an empty object, an empty array or null into a delete", () => {
    const storage = memoryStorage({ "k/a": 1, "k/b": 2, "k/c": 3 });
    writePersisted("k", "a", {}, storage);
    writePersisted("k", "b", [], storage);
    writePersisted("k", "c", null, storage);
    expect(storage.values.size).toBe(0);
  });

  it("answers undefined rather than throwing when the storage throws", () => {
    const broken: DataTablePersistenceStorage = {
      read: () => {
        throw new Error("down");
      },
      write: () => {
        throw new Error("down");
      },
    };
    expect(readPersisted("k", "a", broken)).toBeUndefined();
    expect(() => writePersisted("k", "a", 1, broken)).not.toThrow();
  });

  it("reads and writes localStorage when no storage is named", () => {
    writePersisted("k", "a", { x: 1 });
    expect(window.localStorage.getItem("k.a")).toBe('{"x":1}');
    expect(readPersisted("k", "a")).toEqual({ x: 1 });
    expect(localStorageDataTableStorage.read("k", "a")).toEqual({ x: 1 });
    writePersisted("k", "a", undefined);
    expect(window.localStorage.getItem("k.a")).toBeNull();
  });
});
