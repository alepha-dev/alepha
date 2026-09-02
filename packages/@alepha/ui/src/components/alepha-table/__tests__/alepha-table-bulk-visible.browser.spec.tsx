import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AlephaTable,
  type BulkAction,
  type BulkMenuAction,
} from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
  shelved: boolean;
}

const rows: Row[] = [
  { id: 1, title: "Alpha", shelved: false },
  { id: 2, title: "Beta", shelved: true },
];

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * A bulk action's `visible` predicate: the pill offers an action only for a
 * selection it fits, and hides the whole pill when nothing fits. Hide, not
 * disable, because a disabled button in a three-item pill is a question and
 * a missing one is an answer (Lore feedback #2063).
 */
describe("AlephaTable (bulk action visibility)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (
    actions: Array<BulkAction<Row> | BulkMenuAction<Row>>,
  ) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <AlephaTable<Row> data={rows} columns={columns} bulkActions={actions} />
      </AlephaContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    return view;
  };

  // The first checkbox is the header's select-all; the row ones follow.
  const selectRow = (index: number) => {
    fireEvent.click(screen.getAllByRole("checkbox")[index + 1]);
  };

  const shelve: BulkAction<Row> = {
    label: "Shelve",
    visible: (selected) => selected.some((row) => !row.shelved),
    onClick: () => undefined,
  };
  const unshelve: BulkAction<Row> = {
    label: "Unshelve",
    visible: (selected) => selected.some((row) => row.shelved),
    onClick: () => undefined,
  };
  const always: BulkAction<Row> = {
    label: "Always",
    onClick: () => undefined,
  };

  it("offers an action only for a selection its predicate accepts", async () => {
    await mount([shelve, unshelve, always]);

    selectRow(0);
    expect(screen.getByRole("button", { name: "Shelve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unshelve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Always" })).toBeTruthy();

    // A mixed selection shows both.
    selectRow(1);
    expect(screen.getByRole("button", { name: "Shelve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unshelve" })).toBeTruthy();

    // Only the shelved row left: the other way round.
    selectRow(0);
    expect(screen.queryByRole("button", { name: "Shelve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unshelve" })).toBeTruthy();
  });

  it("applies the predicate to a menu action too", async () => {
    const menu: BulkMenuAction<Row> = {
      label: "Add to release",
      visible: (selected) => selected.every((row) => !row.shelved),
      items: () => [{ label: "0.1.0", onClick: () => undefined }],
    };
    await mount([menu, always]);

    selectRow(0);
    expect(screen.getByRole("button", { name: /Add to release/ })).toBeTruthy();

    selectRow(1);
    expect(screen.queryByRole("button", { name: /Add to release/ })).toBeNull();
  });

  it("hides the pill when nothing in it fits the selection", async () => {
    await mount([unshelve]);

    selectRow(0);
    expect(screen.queryByText("1 selected")).toBeNull();

    selectRow(1);
    expect(screen.getByText("2 selected")).toBeTruthy();
  });
});
