import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { type ReactElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { buildTree, flattenTree, type TreeItem } from "../tree-model.ts";
import { TreeViewRenameInput } from "../tree-view-rename-input.tsx";
import { TreeView } from "../tree-view.tsx";

const ITEMS: TreeItem[] = [
  { id: "a", name: "Alpha", branch: false },
  { id: "b", name: "Bravo", branch: false },
];

/**
 * A consumer that owns the names, the way a real one does: `onCommitRename`
 * writes, and the label the input reopens on comes back through `rows`.
 */
interface HarnessProps {
  onCommit?: (id: string, name: string) => void;
  withMenu?: boolean;
}

const Harness = (props: HarnessProps): ReactElement => {
  const [names, setNames] = useState<Record<string, string>>({
    a: "Alpha",
    b: "Bravo",
  });
  const [renamingId, setRenamingId] = useState<string | undefined>();

  const nodes = buildTree(ITEMS.map((i) => ({ ...i, name: names[i.id] })));

  return (
    <div>
      <button type="button" onClick={() => setRenamingId("a")}>
        rename a
      </button>
      <TreeView
        label="Files"
        rows={flattenTree(nodes, new Set())}
        collapsed={new Set()}
        onSelect={() => {}}
        onToggle={() => {}}
        renamingId={renamingId}
        onCommitRename={(id, name) => {
          props.onCommit?.(id, name);
          setNames({ ...names, [id]: name });
          setRenamingId(undefined);
        }}
        onCancelRename={() => setRenamingId(undefined)}
        renderMenu={
          props.withMenu ? (node) => <div>menu for {node.name}</div> : undefined
        }
      />
    </div>
  );
};

describe("TreeView inline rename", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (props: HarnessProps = {}) => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <Harness {...props} />
      </AlephaContext.Provider>,
    );
  };

  const openRename = () => fireEvent.click(screen.getByText("rename a"));

  const input = (): HTMLInputElement =>
    screen.getByRole("textbox", { name: "New name" }) as HTMLInputElement;

  it("opens on the current name, focused and selected", async () => {
    await mount();
    openRename();

    // The a11y rule that removed `autoFocus` left rename opening an input
    // nobody could type into without clicking it first.
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(input().value).toBe("Alpha");
  });

  it("commits on blur", async () => {
    const committed: [string, string][] = [];
    await mount({ onCommit: (id, name) => committed.push([id, name]) });
    openRename();

    fireEvent.change(input(), { target: { value: "Renamed" } });
    fireEvent.blur(input());

    expect(committed).toEqual([["a", "Renamed"]]);
    expect(screen.getByText("Renamed")).toBeTruthy();
  });

  it("commits on Enter, through the same blur path", async () => {
    const committed: [string, string][] = [];
    await mount({ onCommit: (id, name) => committed.push([id, name]) });
    openRename();

    fireEvent.change(input(), { target: { value: "Entered" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(committed).toEqual([["a", "Entered"]]));
  });

  it("discards the edit on Escape", async () => {
    const committed: [string, string][] = [];
    await mount({ onCommit: (id, name) => committed.push([id, name]) });
    openRename();

    fireEvent.change(input(), { target: { value: "Discarded" } });
    fireEvent.keyDown(input(), { key: "Escape" });

    expect(committed).toEqual([]);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Discarded")).toBeNull();
  });

  it("reopens on the CURRENT name the second time, not the original", async () => {
    // The bug this pins: with the draft initialised once for the life of a
    // row, renaming the same row twice reopens showing the name it had
    // before the first rename.
    await mount();

    openRename();
    fireEvent.change(input(), { target: { value: "First" } });
    fireEvent.blur(input());
    await waitFor(() => expect(screen.getByText("First")).toBeTruthy());

    openRename();
    expect(input().value).toBe("First");
  });

  it("hides the label and the trailing slot while renaming", async () => {
    await mount();
    openRename();

    expect(screen.queryByText("Alpha")).toBeNull();
    // The sibling is untouched.
    expect(screen.getByText("Bravo")).toBeTruthy();
  });
});

describe("TreeView context-menu slot", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (withMenu: boolean) => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <Harness withMenu={withMenu} />
      </AlephaContext.Provider>,
    );
  };

  const rowOf = (label: string): HTMLElement =>
    screen
      .getByText(label)
      .closest('[data-slot="tree-view-row"]') as HTMLElement;

  it("mounts nothing when no slot is given", async () => {
    await mount(false);

    expect(screen.queryByText(/menu for/)).toBeNull();
    expect(rowOf("Alpha")).toBeTruthy();
  });

  it("calls the slot with its node and mounts what it returns", async () => {
    await mount(true);

    expect(screen.getByText(/menu for Alpha/)).toBeTruthy();
    expect(screen.getByText(/menu for Bravo/)).toBeTruthy();
  });

  it("keeps the row's own data-slot through the trigger's prop merge", async () => {
    // ⚠️ `ContextMenuTrigger` renders our element through its `render` prop
    // and merges its own props into it, `data-slot="context-menu-trigger"`
    // included. Ours wins, and it has to: both this package's specs and
    // every consumer's find rows by it.
    await mount(true);

    const row = rowOf("Alpha");
    expect(row.getAttribute("data-slot")).toBe("tree-view-row");
    expect(row.getAttribute("role")).toBe("treeitem");
  });

  // ⚠️ Per folio #F1208 this proves the WIRING and never the gesture: the
  // menu is a portal jsdom cannot lay out. Right-click, Rename, Escape is
  // #Q1947's Playwright case.
});

/**
 * The `cancelledRef` guard, at the only level where the ordering it exists for
 * can be reproduced.
 *
 * ⚠️ Driving it through `TreeView` proves nothing about the guard. There,
 * Escape is a discrete event, so React flushes the consumer's state change
 * synchronously and the input is unmounted before any blur can be dispatched
 * at it: the case passes with the guard REMOVED, which is the shape of a test
 * that is testing nothing. Measured, not assumed.
 *
 * The browser's ordering is the other one: removing a focused element can fire
 * `blur` while the element is still there to receive it. Rendering the input
 * on its own reproduces exactly that, because nothing here unmounts it.
 */
describe("TreeViewRenameInput cancel guard", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("does not commit a blur that arrives after Escape", async () => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();

    const committed: string[] = [];
    const cancelled: number[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <TreeViewRenameInput
          name="Alpha"
          onCommit={(name) => committed.push(name)}
          onCancel={() => cancelled.push(1)}
        />
      </AlephaContext.Provider>,
    );

    const el = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(el, { target: { value: "Discarded" } });
    fireEvent.keyDown(el, { key: "Escape" });
    fireEvent.blur(el);

    expect(cancelled).toEqual([1]);
    expect(committed).toEqual([]);
  });

  it("still commits an ordinary blur", async () => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();

    const committed: string[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <TreeViewRenameInput
          name="Alpha"
          onCommit={(name) => committed.push(name)}
          onCancel={() => {}}
        />
      </AlephaContext.Provider>,
    );

    const el = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(el, { target: { value: "Kept" } });
    fireEvent.blur(el);

    expect(committed).toEqual(["Kept"]);
  });
});
