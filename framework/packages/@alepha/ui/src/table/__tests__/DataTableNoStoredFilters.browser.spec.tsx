import { render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, ReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type { DataTableFilterFields } from "../dataTableTypes.ts";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
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

const filterFields = {
  search: { preset: "search" },
  status: { schema: z.array(z.enum(["new", "triaged", "done"])) },
} satisfies DataTableFilterFields;

class App {
  list = $page({
    path: "/list",
    component: () => <div>list</div>,
  });
}

/**
 * `?filters=none`, the reserved key (#Q3536).
 *
 * A link carrying a filter already replaces the stored ones. A link to the
 * whole list carries none, so it used to get the reader's stored filters on
 * top, and a dashboard tile counting every user opened a list of some of
 * them. The reserved key says "these filters exactly, none stored".
 */
describe("DataTable (?filters=none)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  const mount = async (
    url: `/${string}`,
    fromQuery: boolean | "search"[] | undefined,
    seen: Array<Record<string, any> | undefined>,
  ) => {
    window.localStorage.setItem(
      "tbl.filters",
      JSON.stringify({ status: ["done"], search: "old" }),
    );
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);
    await act(async () => {
      await router.push(url);
    });
    return render(
      <AlephaContext.Provider value={alepha!}>
        <DataTable<Row, typeof filterFields>
          columns={columns}
          persistenceKey="tbl"
          filters={{ fields: filterFields, fromQuery }}
          fetch={async (params) => {
            seen.push(params.filters);
            return pageOf([{ id: 1, title: "Alpha" }]);
          }}
        />
      </AlephaContext.Provider>,
    );
  };

  it("keeps the stored filters for a link that carries none", async () => {
    const seen: Array<Record<string, any> | undefined> = [];
    await mount("/list", true, seen);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.status).toEqual(["done"]);
  });

  it("drops the stored filters for ?filters=none", async () => {
    const seen: Array<Record<string, any> | undefined> = [];
    await mount("/list?filters=none", true, seen);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.status).toBeUndefined();
    expect(seen[0]?.search).toBeUndefined();
  });

  it("applies the link's own filters, and only them, beside ?filters=none", async () => {
    const seen: Array<Record<string, any> | undefined> = [];
    await mount("/list?filters=none&search=fresh", ["search"], seen);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.search).toBe("fresh");
    expect(seen[0]?.status).toBeUndefined();
  });

  it("is not read by a table that did not opt into fromQuery", async () => {
    const seen: Array<Record<string, any> | undefined> = [];
    await mount("/list?filters=none", undefined, seen);

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.status).toEqual(["done"]);
  });
});
