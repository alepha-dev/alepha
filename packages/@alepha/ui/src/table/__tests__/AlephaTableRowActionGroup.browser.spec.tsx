import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/react/testing";
import { Bot, Trash2 } from "lucide-react";
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
 * A row action may be a group: a label, an icon and the actions it holds,
 * rendered as a submenu one level deep.
 *
 * Two behaviours are guarded here. The submenu itself, and the rule that a
 * group with no children does not count towards the menu existing: a row
 * whose only entry is an empty group gets no trigger at all, so a caller
 * can build `children` conditionally without checking what survived.
 */
describe("AlephaTable (row action groups)", () => {
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

  const openRowMenu = async () => {
    const trigger = await waitFor(() =>
      screen.getByRole("button", { name: "Open row actions" }),
    );
    fireEvent.click(trigger);
    return await waitFor(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      expect(items.length).toBeGreaterThan(0);
      return Array.from(items) as HTMLElement[];
    });
  };

  it("renders a group as one submenu trigger, not as its children", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        rowActions={() => [
          {
            label: "Agent Prompts",
            icon: Bot,
            children: [
              { label: "Review", onClick: () => {} },
              { label: "Activate", onClick: () => {} },
            ],
          },
        ]}
      />,
    );

    const items = await openRowMenu();
    const labels = items.map((it) => it.textContent ?? "");
    expect(labels.join(" ")).toContain("Agent Prompts");
    // Closed, the children are not in the document: the submenu content is
    // portalled on open, not rendered flat beside the trigger.
    expect(labels.join(" ")).not.toContain("Review");
  });

  it("renders no menu at all when the only entry is an empty group", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        rowActions={() => [{ label: "Agent Prompts", icon: Bot, children: [] }]}
      />,
    );

    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    // ⚠️ The guard under test. Without the effective-entry count, a group
    // is one entry however many children it has, and this row renders a
    // three-dots trigger over an empty dropdown.
    expect(screen.queryByRole("button", { name: "Open row actions" })).toBe(
      null,
    );
  });

  it("keeps the plain actions beside an empty group", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        rowActions={() => [
          { label: "Detach", onClick: () => {} },
          { label: "Agent Prompts", icon: Bot, children: [] },
        ]}
      />,
    );

    const items = await openRowMenu();
    const labels = items.map((it) => it.textContent ?? "");
    expect(labels.join(" ")).toContain("Detach");
    expect(labels.join(" ")).not.toContain("Agent Prompts");
  });

  it("separates a destructive action that follows a group", async () => {
    await mount(
      <AlephaTable<Row>
        data={[{ id: 1, title: "Alpha" }]}
        columns={columns}
        rowActions={() => [
          {
            label: "Agent Prompts",
            icon: Bot,
            children: [{ label: "Work on it", onClick: () => {} }],
          },
          {
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onClick: () => {},
          },
        ]}
      />,
    );

    await openRowMenu();
    // A group carries no `destructive` field, so the entry before Delete
    // reads as non-destructive and the separator is still emitted.
    expect(
      document.querySelector('[data-slot="dropdown-menu-separator"]'),
    ).toBeTruthy();
  });

  it("opens the submenu and calls the child handler with the row", async () => {
    let clicked: Row | undefined;
    await mount(
      <AlephaTable<Row>
        data={[{ id: 7, title: "Alpha" }]}
        columns={columns}
        rowActions={() => [
          {
            label: "Agent Prompts",
            icon: Bot,
            children: [
              {
                label: "Work on it",
                onClick: (row) => {
                  clicked = row;
                },
              },
            ],
          },
        ]}
      />,
    );

    const items = await openRowMenu();
    const groupTrigger = items.find((it) =>
      (it.textContent ?? "").includes("Agent Prompts"),
    );
    expect(groupTrigger).toBeTruthy();

    // ⚠️ The gesture, written down here so the Lore specs copy it rather
    // than rediscover it. A plain `fireEvent.click` on the trigger opens
    // the submenu under jsdom, the same gesture as the row menu itself,
    // and `pointerDown` is neither needed nor sufficient on its own.
    // The content is portalled, so the child is found on `document` and
    // never inside the render result.
    fireEvent.click(groupTrigger!);

    const child = await waitFor(() => {
      const found = Array.from(
        document.querySelectorAll('[role="menuitem"]'),
      ).find((it) => (it.textContent ?? "").includes("Work on it"));
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });

    fireEvent.click(child);
    await waitFor(() => expect(clicked).toBeTruthy());
    expect(clicked?.id).toBe(7);
  });
});
