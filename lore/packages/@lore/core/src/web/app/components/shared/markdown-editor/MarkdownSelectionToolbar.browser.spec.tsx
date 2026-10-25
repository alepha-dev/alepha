import type { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18n } from "../../../services/I18n.ts";
import MarkdownSelectionToolbar from "./MarkdownSelectionToolbar.tsx";

/**
 * When the floating format bar is allowed to appear (feedback #P2116).
 *
 * ⚠️ The view is a STUB, not a real `EditorView`, and that is the point.
 * jsdom measures nothing, so a real CodeMirror's `coordsAtPos` cannot place
 * the bar and every case here would pass for the wrong reason - the bar
 * absent because it has no coordinates rather than because it was
 * suppressed. The component reads four things off the view; a stub supplies
 * all four honestly and leaves the gesture logic as the only variable.
 *
 * The gesture itself is a browser matter and is not attempted here: jsdom
 * has no drag, which is the same wall the tree work hit (folio #F1232).
 * What is testable at this level is the FLAG - down, selection changes, up,
 * delay - and that is what these cases drive.
 */
describe("MarkdownSelectionToolbar", () => {
  let alepha: Alepha | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await alepha?.stop();
    alepha = undefined;
  });

  /**
   * The four members the component reads, and nothing else.
   *
   * `editor` is the element the containment check asks about, so a press
   * inside it is a selection gesture and a press anywhere else is not. The
   * range is MUTABLE and starts empty, so every case here begins with no bar
   * on screen and has to earn one - otherwise the mount's own `sync` would
   * put it there and each assertion would hold for the wrong reason.
   */
  const stubView = (
    editor: HTMLElement,
    // ⚠️ Held by reference and never spread: `sync` reads
    // `state.selection.main` on every call, so the object the component sees
    // has to be the one a case mutates. Copying it here made all five cases
    // fail at once, each for the same invisible reason.
    range: { from: number; to: number; empty: boolean },
  ) =>
    ({
      dom: editor,
      hasFocus: true,
      state: { selection: { main: range } },
      coordsAtPos: () => ({ left: 10, right: 40, top: 60, bottom: 80 }),
    }) as unknown as EditorView;

  const mount = async () => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const editor = document.createElement("div");
    document.body.append(editor);
    const range = { from: 0, to: 4, empty: true };

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <MarkdownSelectionToolbar view={stubView(editor, range)} />
      </AlephaContext.Provider>,
    );

    expect(screen.queryByTestId("markdown-selection-toolbar")).toBeNull();

    /**
     * One more character under the cursor, announced the way the browser
     * announces it. `state.selection.main` is read on every `sync`, so
     * widening the range here is what a real selection growing looks like.
     */
    const selectionGrows = () =>
      act(() => {
        range.empty = false;
        document.dispatchEvent(new Event("selectionchange"));
      });

    return { editor, view, selectionGrows };
  };

  const bar = () => screen.queryByTestId("markdown-selection-toolbar");

  it("stays hidden for the whole drag, and appears a beat after the release", async () => {
    const { editor, selectionGrows } = await mount();

    fireEvent.pointerDown(editor);
    // Every mousemove of a drag-select emits one of these. Before this
    // change the bar appeared on the first and then chased the anchor.
    selectionGrows();
    selectionGrows();
    selectionGrows();
    expect(bar()).toBeNull();

    fireEvent.pointerUp(document);
    // ⚠️ Not yet: the delay is what the reporter asked for by name, and it
    // also lets a last `selectionchange` land.
    expect(bar()).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(bar()).not.toBeNull();
  });

  it("resolves a drag that is released outside the editor", async () => {
    // The listener is on the document for exactly this: a selection that
    // starts in the text and ends in the margin releases there, and a
    // listener on the editor would leave the flag set and the bar gone
    // until the next press.
    const { editor, selectionGrows } = await mount();
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);

    fireEvent.pointerDown(editor);
    selectionGrows();
    fireEvent.pointerUp(elsewhere);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(bar()).not.toBeNull();
  });

  it("shows on a keyboard selection with no pointer event at all", async () => {
    // shift+arrows and cmd+A never emit a pointerup, so gating on one would
    // make the bar unreachable from the keyboard. No timer is advanced here
    // either: a keyboard selection is not a gesture and waits for nothing.
    const { selectionGrows } = await mount();

    selectionGrows();

    expect(bar()).not.toBeNull();
  });

  it("keeps following a standing selection through a scroll", async () => {
    const { editor, selectionGrows } = await mount();

    fireEvent.pointerDown(editor);
    selectionGrows();
    fireEvent.pointerUp(document);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(bar()).not.toBeNull();

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    // Still there: the drag flag is down, so `sync` places it as before
    // rather than suppressing it.
    expect(bar()).not.toBeNull();
  });

  it("does not hide itself when the press lands on one of its own buttons", async () => {
    // The bar's buttons are outside `view.dom`, so pressing one is not a
    // selection gesture. Hiding under the finger about to release on it
    // would make every command unreachable.
    const { editor, selectionGrows } = await mount();

    fireEvent.pointerDown(editor);
    selectionGrows();
    fireEvent.pointerUp(document);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const bold = screen.getByRole("button", { name: "Bold" });
    fireEvent.pointerDown(bold);

    expect(bar()).not.toBeNull();
  });
});
