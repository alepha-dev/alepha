import { render, screen, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { Ghost } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

const filtersSchema = z.object({
  search: z.string().optional(),
});

/**
 * An empty page has two readings, and the table has to tell them apart.
 *
 * "There is nothing here" and "nothing matched your filter" ask the reader
 * for opposite things - create something, or widen the filter - so a table
 * that says one sentence for both sends half of them the wrong way. The
 * signal is `activeFilterCount`, which these cases drive through the real
 * filter form rather than by setting the mode directly: the bug worth
 * catching is the detection going wrong, not the wording.
 */
describe("AlephaTable (empty states)", () => {
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

  it("says there is nothing here when no filter is set", async () => {
    await mount(<AlephaTable<Row> data={[]} columns={columns} />);

    await waitFor(() => expect(screen.getByText("No items")).toBeTruthy());
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    expect(screen.queryByText("No match")).toBeNull();
  });

  it("still says there is nothing here when a filter form exists but is empty", async () => {
    // The form being mounted is not the signal - a reader who has typed
    // nothing has filtered nothing, and telling them to adjust a filter they
    // never set is the failure this case exists to catch.
    await mount(
      <AlephaTable<Row>
        data={[]}
        columns={columns}
        filters={{ schema: filtersSchema, render: () => null }}
      />,
    );

    await waitFor(() => expect(screen.getByText("No items")).toBeTruthy());
    expect(screen.queryByText("No match")).toBeNull();
  });

  it("says nothing matched once a filter carries a value", async () => {
    await mount(
      <AlephaTable<Row>
        data={[]}
        columns={columns}
        filters={{
          schema: filtersSchema,
          seedValues: { search: "nobody" },
          render: () => null,
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText("No match")).toBeTruthy());
    expect(
      screen.getByText("Try adjusting or clearing the filters."),
    ).toBeTruthy();
    expect(screen.queryByText("No items")).toBeNull();
  });

  it("lets emptyMessage replace the title, and drops the description with it", async () => {
    // The one-line escape hatch every existing caller uses. Pairing their
    // sentence with a stock second line reads as the component talking over
    // them, so the description goes away rather than stacking.
    await mount(
      <AlephaTable<Row>
        data={[]}
        columns={columns}
        emptyMessage="Nothing attached"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Nothing attached")).toBeTruthy(),
    );
    expect(screen.queryByText("No items")).toBeNull();
    expect(screen.queryByText("Nothing here yet.")).toBeNull();
  });

  it("takes per-mode wording from emptyState", async () => {
    await mount(
      <AlephaTable<Row>
        data={[]}
        columns={columns}
        emptyState={{
          icon: Ghost,
          title: "No members",
          description: "Invite someone to get started.",
        }}
        noMatchState={{ title: "Nobody like that" }}
      />,
    );

    await waitFor(() => expect(screen.getByText("No members")).toBeTruthy());
    expect(screen.getByText("Invite someone to get started.")).toBeTruthy();
    // The other mode's override is not reachable from here, and must not
    // leak into this one.
    expect(screen.queryByText("Nobody like that")).toBeNull();
  });

  it("takes per-mode wording from noMatchState, keeping its default description", async () => {
    await mount(
      <AlephaTable<Row>
        data={[]}
        columns={columns}
        filters={{
          schema: filtersSchema,
          seedValues: { search: "nobody" },
          render: () => null,
        }}
        noMatchState={{ title: "Nobody like that" }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Nobody like that")).toBeTruthy(),
    );
    // A title override on its own leaves the description alone: only
    // `emptyMessage` claims the whole message.
    expect(
      screen.getByText("Try adjusting or clearing the filters."),
    ).toBeTruthy();
  });

  it("renders the state's action, and only for the state that is showing", async () => {
    await mount(
      <AlephaTable<Row>
        data={[]}
        columns={columns}
        emptyState={{
          title: "No members yet",
          action: <button type="button">Invite a member</button>,
        }}
        noMatchState={{ action: <button type="button">Clear filters</button> }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Invite a member")).toBeTruthy(),
    );
    // No filter is set, so the no-match action belongs to a state that is not
    // on screen and must not render alongside the one that is.
    expect(screen.queryByText("Clear filters")).toBeNull();
  });

  it("lets empty replace both states outright", async () => {
    await mount(
      <AlephaTable<Row>
        data={[]}
        columns={columns}
        emptyMessage="ignored"
        emptyState={{ title: "also ignored" }}
        empty={<p>Bring your own</p>}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Bring your own")).toBeTruthy(),
    );
    expect(screen.queryByText("ignored")).toBeNull();
    expect(screen.queryByText("also ignored")).toBeNull();
  });
});
