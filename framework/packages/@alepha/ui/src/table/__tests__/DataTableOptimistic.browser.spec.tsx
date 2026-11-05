import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha, type Page } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";
import type { OptimisticHandle } from "../useOptimisticRows.ts";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * `ctx.optimistic` on a fetched table: rows change on screen before the
 * server answers, and the overlay lets go only once a reload sent after the
 * write has answered.
 */
describe("DataTable (optimistic rows)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  /**
   * A table over a server list the spec edits by hand. The row action does
   * whatever `act` says with the context, and hands back the handle.
   */
  const mount = async (
    act: (
      row: Row,
      ctx: {
        optimistic: {
          remove: (r: Row) => OptimisticHandle;
          patch: (r: Row, next: Row) => OptimisticHandle;
        };
      },
    ) => OptimisticHandle,
  ) => {
    const server = {
      rows: [
        { id: 1, title: "Alpha" },
        { id: 2, title: "Beta" },
        { id: 3, title: "Gamma" },
      ] as Row[],
      fetches: [] as number[],
    };
    const handle: { current?: OptimisticHandle } = {};
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row>
          columns={columns}
          fetch={async ({ page, size }): Promise<Page<Row>> => {
            server.fetches.push(page);
            return {
              content: [...server.rows],
              page: {
                number: page,
                size,
                totalElements: server.rows.length,
                totalPages: 1,
                isEmpty: server.rows.length === 0,
                isFirst: true,
                isLast: true,
              },
            } as unknown as Page<Row>;
          }}
          rowActions={() => [
            {
              label: "Act",
              onClick: (row, ctx) => {
                handle.current = act(row, ctx);
              },
            },
          ]}
        />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Beta")).toBeTruthy());
    return { server, handle };
  };

  const actOn = async (index: number) => {
    fireEvent.click(
      screen.getAllByRole("button", { name: "Open row actions" })[index],
    );
    const entry = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === "Act",
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(entry);
  };

  const titles = () =>
    [...document.querySelectorAll("tbody tr[data-row-key]")].map(
      (row) => row.textContent,
    );

  it("takes a removed row off the page before any request, and rollback brings it back", async () => {
    const { server, handle } = await mount((row, ctx) =>
      ctx.optimistic.remove(row),
    );
    const fetchesBefore = server.fetches.length;

    await actOn(1);
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Gamma"]));
    expect(server.fetches.length).toBe(fetchesBefore);

    handle.current!.rollback();
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]));
  });

  it("redraws a patched row, and settle reloads in place", async () => {
    const { server, handle } = await mount((row, ctx) =>
      ctx.optimistic.patch(row, { ...row, title: `${row.title} (patched)` }),
    );

    await actOn(0);
    await waitFor(() =>
      expect(titles()).toEqual(["Alpha (patched)", "Beta", "Gamma"]),
    );

    // The server agrees, then the overlay lets go once a reload answers.
    server.rows[0] = { id: 1, title: "Alpha (server)" };
    const fetchesBefore = server.fetches.length;
    handle.current!.settle();
    await waitFor(() =>
      expect(titles()).toEqual(["Alpha (server)", "Beta", "Gamma"]),
    );
    expect(server.fetches.length).toBe(fetchesBefore + 1);
    // `reload`, not `refresh`: the page it fetched is the one it was on.
    expect(server.fetches.at(-1)).toBe(0);
  });

  it("puts a settled removal back at its old index when it is rolled back", async () => {
    const { server, handle } = await mount((row, ctx) =>
      ctx.optimistic.remove(row),
    );

    await actOn(1);
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Gamma"]));

    // The server dropped it and the overlay let go...
    server.rows = server.rows.filter((row) => row.id !== 2);
    handle.current!.settle();
    await waitFor(() => expect(server.fetches.length).toBeGreaterThan(1));
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Gamma"]));

    // ...then Undo: the row is back where it was, before any request.
    const fetchesBefore = server.fetches.length;
    handle.current!.rollback();
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Beta", "Gamma"]));
    expect(server.fetches.length).toBe(fetchesBefore);
  });
});
