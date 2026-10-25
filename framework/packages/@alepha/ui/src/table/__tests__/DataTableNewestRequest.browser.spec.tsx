import { act, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DataTable } from "../DataTable.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const page = (title: string) => ({
  content: [{ id: 1, title }],
  page: {
    number: 0,
    size: 20,
    totalElements: 1,
    totalPages: 1,
    isEmpty: false,
    isFirst: true,
    isLast: true,
  },
});

/**
 * #Q2517: every load's result was written whenever it arrived, so a slow
 * older request (a project switch, a filter keystroke, a refresh) put the
 * previous rows back over the newer ones.
 */
describe("DataTable (the newest request wins)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("keeps the newer rows when an older request answers last, and aborts it", async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const calls: Array<{
      resolve: (value: ReturnType<typeof page>) => void;
      signal?: AbortSignal;
    }> = [];
    const fetch = (params: { signal?: AbortSignal }) =>
      new Promise<ReturnType<typeof page>>((resolve) => {
        calls.push({ resolve, signal: params.signal });
      });

    const tree = (signal: number) => (
      <AlephaContext.Provider value={alepha!}>
        <DataTable<Row>
          fetch={fetch as never}
          refreshSignal={signal}
          columns={columns}
        />
      </AlephaContext.Provider>
    );
    const view = render(tree(0));
    await waitFor(() => expect(calls).toHaveLength(1));

    // A second load starts while the first is still out.
    view.rerender(tree(1));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]!.signal?.aborted).toBe(true);

    await act(async () => {
      calls[1]!.resolve(page("newer project"));
    });
    await waitFor(() => expect(screen.getByText("newer project")).toBeTruthy());

    // The older request answers last. It used to win.
    await act(async () => {
      calls[0]!.resolve(page("older project"));
    });
    expect(screen.queryByText("older project")).toBeNull();
    expect(screen.getByText("newer project")).toBeTruthy();
  });
});
