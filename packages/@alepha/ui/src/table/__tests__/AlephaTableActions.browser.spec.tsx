import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { Download, Plus } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * The toolbar `actions` slot has two forms. A secondary action is a ghost
 * icon whose label lives in a tooltip; a `primary` one is a solid button
 * that shows its label. The regression this guards is the one feedback
 * #2055 reported: a create control rendered as a bare `+` at the same
 * weight as the column picker, invisible on the page it was the point of.
 */
describe("AlephaTable (toolbar actions)", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: React.ReactNode) => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  it("renders a primary action as a solid button carrying its label", async () => {
    let clicks = 0;
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        actions={[
          {
            icon: Plus,
            label: "Create Epic",
            primary: true,
            onClick: () => {
              clicks += 1;
            },
          },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    const button = screen.getByRole("button", { name: "Create Epic" });
    // The label is in the button, not only in a tooltip that opens later.
    expect(button.textContent).toBe("Create Epic");
    // Solid, not ghost: the primary surface is the whole point.
    expect(button.className).toContain("bg-primary");

    fireEvent.click(button);
    expect(clicks).toBe(1);
  });

  it("keeps a secondary action as an icon-only ghost button", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        actions={[{ icon: Download, label: "Export", onClick: () => {} }]}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    // Named through `aria-label`, with no visible text of its own.
    const button = screen.getByRole("button", { name: "Export" });
    expect(button.textContent).toBe("");
    expect(button.className).not.toContain("bg-primary");
  });

  it("renders both forms side by side, in declaration order", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        actions={[
          { icon: Plus, label: "New", primary: true, onClick: () => {} },
          { icon: Download, label: "Export", onClick: () => {} },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());

    const primary = screen.getByRole("button", { name: "New" });
    const secondary = screen.getByRole("button", { name: "Export" });
    expect(
      primary.compareDocumentPosition(secondary) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
