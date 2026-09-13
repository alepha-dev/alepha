import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  TREE_VIEW_DEFAULT_WIDTH,
  TREE_VIEW_MAX_WIDTH,
  TREE_VIEW_MIN_WIDTH,
  TreeViewResizer,
} from "../tree-view-resizer.tsx";

describe("TreeViewResizer", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (ui: ReactNode) => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
    return screen.getByRole("separator");
  };

  it("announces the bounds it is working within", async () => {
    const handle = await mount(
      <TreeViewResizer width={200} onWidth={() => {}} />,
    );

    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-label")).toBe("Resize tree");
    expect(handle.getAttribute("aria-valuenow")).toBe("200");
    expect(handle.getAttribute("aria-valuemin")).toBe(
      String(TREE_VIEW_MIN_WIDTH),
    );
    expect(handle.getAttribute("aria-valuemax")).toBe(
      String(TREE_VIEW_MAX_WIDTH),
    );
  });

  it("takes a consumer's own bounds over the defaults", async () => {
    const handle = await mount(
      <TreeViewResizer
        width={200}
        onWidth={() => {}}
        minWidth={100}
        maxWidth={300}
      />,
    );

    expect(handle.getAttribute("aria-valuemin")).toBe("100");
    expect(handle.getAttribute("aria-valuemax")).toBe("300");
  });

  it("resets to the default width on a double click", async () => {
    const widths: number[] = [];
    const handle = await mount(
      <TreeViewResizer width={400} onWidth={(w) => widths.push(w)} />,
    );

    fireEvent.doubleClick(handle);
    expect(widths).toEqual([TREE_VIEW_DEFAULT_WIDTH]);
  });

  it("resets to a consumer's own default width", async () => {
    const widths: number[] = [];
    const handle = await mount(
      <TreeViewResizer
        width={400}
        onWidth={(w) => widths.push(w)}
        defaultWidth={321}
      />,
    );

    fireEvent.doubleClick(handle);
    expect(widths).toEqual([321]);
  });

  it("reports the width the drag reached, and never clamps it itself", async () => {
    // Clamping and persisting are both the consumer's: it owns the pane and
    // the preference, and a handle that silently clamped would disagree
    // with whatever bounds the consumer actually applies.
    const widths: number[] = [];
    const handle = await mount(
      <TreeViewResizer width={200} onWidth={(w) => widths.push(w)} />,
    );

    // jsdom has no pointer capture, so the two calls the handler makes have
    // to exist for the gesture to run at all.
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 });

    expect(widths).toEqual([260, -200]);

    // After the gesture ends, a stray move reports nothing.
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });
    expect(widths).toEqual([260, -200]);
  });
});
