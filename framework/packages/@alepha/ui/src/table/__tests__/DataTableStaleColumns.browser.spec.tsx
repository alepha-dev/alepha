import { render, screen } from "@testing-library/react";
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
  owner: string;
}

const rows: Row[] = [{ id: 1, title: "Alpha", owner: "ada" }];

/**
 * A stored column set written by an older layout of the same table.
 *
 * The visible set is persisted as a list of column keys. When a table's
 * columns are all renamed, the list a reader stored before names none of them,
 * and it used to win: the table rendered its rows with zero columns, a row of
 * empty cells and no header labels, for every reader who had once toggled a
 * column. A set that keeps nothing now falls back to the declaration.
 */
describe("DataTable (stale persisted columns)", () => {
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
    return render(
      <AlephaContext.Provider value={alepha}>
        <DataTable<Row>
          persistenceKey="probe"
          rowKey={(r) => String(r.id)}
          data={rows}
          columns={{
            title: { label: "Title", cell: (r: Row) => r.title },
            owner: { label: "Owner", cell: (r: Row) => r.owner },
          }}
        />
      </AlephaContext.Provider>,
    );
  };

  it("shows the declared columns when the stored set names none of them", async () => {
    window.localStorage.setItem(
      "probe.columns",
      JSON.stringify(["name", "email"]),
    );
    await mount();
    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.getByText("ada")).toBeTruthy();
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
  });

  it("keeps a stored choice that still names a column", async () => {
    window.localStorage.setItem(
      "probe.columns",
      JSON.stringify(["title", "email"]),
    );
    await mount();
    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("ada")).toBeNull();
  });
});
