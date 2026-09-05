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
  owner: string;
}

const rows: Row[] = [{ id: 1, title: "Alpha", owner: "ada" }];

const fetchRows = async () => ({
  content: rows,
  page: {
    number: 0,
    size: 20,
    offset: 0,
    numberOfElements: rows.length,
    totalElements: rows.length,
    totalPages: 1,
    isEmpty: false,
    isFirst: true,
    isLast: true,
  },
});

/**
 * `defaultHidden` used to survive exactly one mount.
 *
 * The visible set was persisted by a mount EFFECT, so merely opening a table
 * stamped the current columns into `localStorage`. From then on the stored set
 * won, and a `defaultHidden` added to a column later did nothing for anyone who
 * had ever opened the page - silently, and with no stored marker to look wrong.
 * It also made the prop unusable as a controlled input, since a remount read
 * back what the previous mount had written.
 *
 * The write now happens on a toggle, which is the only thing that expresses a
 * reader's choice.
 */
describe("AlephaTable (defaultHidden vs persisted columns)", () => {
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

  const table = (hideOwner: boolean) => (
    <AlephaTable<Row>
      persistenceKey="probe"
      columns={{
        title: { label: "Title", cell: (r: Row) => r.title },
        owner: {
          label: "Owner",
          cell: (r: Row) => r.owner,
          defaultHidden: hideOwner,
        },
      }}
      fetch={fetchRows}
    />
  );

  it("should hide a defaultHidden column", async () => {
    await mount(table(true));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(screen.queryByText("Owner")).toBeNull();
  });

  it("should not persist the visible set on mount alone", async () => {
    const view = await mount(table(false));

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(screen.queryByText("Owner")).toBeTruthy();

    // The reader touched nothing, so nothing about their choices is stored.
    expect(window.localStorage.getItem("probe.columns")).toBeNull();

    // Which is what lets a later `defaultHidden` still apply.
    view.unmount();
    await alepha?.stop();
    alepha = undefined;

    await mount(table(true));
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(screen.queryByText("Owner")).toBeNull();
  });
});
