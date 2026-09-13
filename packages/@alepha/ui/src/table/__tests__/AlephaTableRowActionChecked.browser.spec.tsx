import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { Flag } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AlephaTable } from "../alepha-table.tsx";

interface Row {
  id: number;
  title: string;
  releaseId?: number;
}

const columns = {
  title: { label: "Title", cell: (r: Row) => r.title },
};

/**
 * A row action that declares `checked` says which of a group's entries is
 * the row's current value.
 *
 * The point of the field is that the mark comes from the primitive: the
 * alternative was gluing a marker into the label, which no locale can own
 * and no assistive tech can read as state.
 */
describe("AlephaTable (checked row actions)", () => {
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

  const openGroup = async (label: string) => {
    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: "Open row actions" }),
    );
    fireEvent.click(trigger);
    const groupTrigger = await waitFor(() => {
      const found = Array.from(
        document.querySelectorAll('[role="menuitem"]'),
      ).find((it) => (it.textContent ?? "").includes(label));
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    fireEvent.click(groupTrigger);
    return await waitFor(() => {
      const items = document.querySelectorAll('[role="menuitemcheckbox"]');
      expect(items.length).toBeGreaterThan(0);
      return Array.from(items) as HTMLElement[];
    });
  };

  const releaseActions = (row: Row, onPick: (id?: number) => void) => [
    {
      label: "Set release",
      icon: Flag,
      children: [
        {
          label: "0.29.0",
          checked: (r: Row) => r.releaseId === 1,
          onClick: () => onPick(1),
        },
        {
          label: "0.30.0",
          checked: (r: Row) => r.releaseId === 2,
          onClick: () => onPick(2),
        },
        {
          label: "No release",
          checked: (r: Row) => r.releaseId === undefined,
          onClick: () => onPick(undefined),
        },
      ],
    },
  ];

  it("marks the entry the row is currently on, and only that one", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha", releaseId: 2 }]}
        columns={columns}
        rowActions={(row) => releaseActions(row, () => {})}
      />,
    );

    const items = await openGroup("Set release");
    const checked = items.filter(
      (it) => it.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain("0.30.0");
  });

  it("marks the No release entry when the row carries none", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        rowActions={(row) => releaseActions(row, () => {})}
      />,
    );

    const items = await openGroup("Set release");
    const checked = items.filter(
      (it) => it.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain("No release");
  });

  it("still calls onClick, including on the entry already checked", async () => {
    const picked: Array<number | undefined> = [];
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha", releaseId: 1 }]}
        columns={columns}
        rowActions={(row) =>
          releaseActions(row, (id) => {
            picked.push(id);
          })
        }
      />,
    );

    const items = await openGroup("Set release");
    // ⚠️ The entry that is already checked. It is controlled with no
    // `onCheckedChange`, so clicking it must still reach `onClick` rather
    // than being swallowed as a toggle back to unchecked.
    const current = items.find((it) =>
      (it.textContent ?? "").includes("0.29.0"),
    );
    fireEvent.click(current!);
    await waitFor(() => expect(picked).toHaveLength(1));
    expect(picked[0]).toBe(1);
  });

  it("honours disabled on a checked entry", async () => {
    const picked: Array<number | undefined> = [];
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha", releaseId: 1 }]}
        columns={columns}
        rowActions={() => [
          {
            label: "Set release",
            icon: Flag,
            children: [
              {
                label: "0.30.0",
                checked: () => false,
                disabled: () => true,
                onClick: () => {
                  picked.push(2);
                },
              },
            ],
          },
        ]}
      />,
    );

    const items = await openGroup("Set release");
    const entry = items.find((it) => (it.textContent ?? "").includes("0.30.0"));
    fireEvent.click(entry!);
    expect(picked).toHaveLength(0);
  });

  it("leaves an entry with no checked field an ordinary menuitem", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        rowActions={() => [{ label: "Detach", onClick: () => {} }]}
      />,
    );

    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: "Open row actions" }),
    );
    fireEvent.click(trigger);
    await waitFor(() => {
      const items = Array.from(
        document.querySelectorAll('[role="menuitem"]'),
      ).map((it) => it.textContent ?? "");
      expect(items.join(" ")).toContain("Detach");
    });
    // The role is what a top-level query filters on, so an entry that never
    // asked to carry state must not have become a checkbox.
    expect(document.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(
      0,
    );
  });
});
