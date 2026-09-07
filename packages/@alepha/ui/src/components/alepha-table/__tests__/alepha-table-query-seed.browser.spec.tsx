import { render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, ReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTable } from "../alepha-table.tsx";

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

const filterSchema = z.object({
  search: z.text().optional(),
  status: z.array(z.enum(["new", "triaged", "done"])).optional(),
});

class App {
  list = $page({
    path: "/list",
    component: () => <div>list</div>,
  });
}

/**
 * `?status=new,triaged` fills the filters on arrival.
 *
 * The link is the drill-through target for a dashboard card and the thing
 * the toolbar's Share item produces, so the two directions have to agree on
 * one spelling.
 *
 * ⚠️ One-directional, and it stays that way. Nothing here writes the filter
 * back into the URL: that is the shape Lore incident #156 was about.
 */
describe("AlephaTable (filters seeded from the query)", () => {
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

  const mount = async (url: string, ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n).with(App);
    await alepha.start();
    const router = alepha.inject(ReactRouter);
    await act(async () => {
      await router.push(url);
    });
    return render(
      <AlephaContext.Provider value={alepha!}>{ui}</AlephaContext.Provider>,
    );
  };

  const table = (
    onFetch: (filters?: Record<string, any>) => void,
    filters: Record<string, any>,
  ) => (
    <AlephaTable<Row>
      columns={columns}
      filters={{
        schema: filterSchema,
        render: () => null,
        ...filters,
      }}
      fetch={async (params) => {
        onFetch(params.filters);
        return pageOf([{ id: 1, title: "Alpha" }]);
      }}
    />
  );

  it("seeds a multi-value filter from a comma-joined param", async () => {
    const seen: Array<Record<string, any> | undefined> = [];

    await mount(
      "/list?status=new,triaged",
      table((f) => seen.push(f), { fromQuery: true }),
    );

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.status).toEqual(["new", "triaged"]);
  });

  it("ignores query params when fromQuery is not set", async () => {
    // The default has to stay off: every table in every app reads this
    // component, and a page's own params are not its table's filters.
    const seen: Array<Record<string, any> | undefined> = [];

    await mount(
      "/list?status=new",
      table((f) => seen.push(f), {}),
    );

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.status).toBeUndefined();
  });

  it("outranks the filter the reader stored last time", async () => {
    // A link that lost to a filter set last week would be a link that does
    // nothing. Same precedence `seedValues` already has.
    window.localStorage.setItem(
      "tbl.filters",
      JSON.stringify({ status: ["done"] }),
    );
    const seen: Array<Record<string, any> | undefined> = [];

    await mount(
      "/list?status=new",
      <AlephaTable<Row>
        columns={columns}
        persistenceKey="tbl"
        filters={{
          schema: filterSchema,
          fromQuery: true,
          render: () => null,
        }}
        fetch={async (params) => {
          seen.push(params.filters);
          return pageOf([{ id: 1, title: "Alpha" }]);
        }}
      />,
    );

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.status).toEqual(["new"]);
  });

  it("reads only the keys an allowlist names", async () => {
    const seen: Array<Record<string, any> | undefined> = [];

    await mount(
      "/list?status=new&search=auth",
      table((f) => seen.push(f), { fromQuery: ["status"] }),
    );

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.status).toEqual(["new"]);
    expect(seen[0]?.search).toBeUndefined();
  });
});
