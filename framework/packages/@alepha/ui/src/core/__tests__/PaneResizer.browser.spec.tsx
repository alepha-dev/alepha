import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  PANE_DEFAULT_WIDTH,
  PANE_MAX_WIDTH,
  PANE_MIN_WIDTH,
  PaneResizer,
} from "../PaneResizer.tsx";

describe("PaneResizer", () => {
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
    const handle = screen.getByRole("separator");
    // jsdom has no pointer capture.
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    return handle;
  };

  it("announces the bounds it is working within", async () => {
    const handle = await mount(<PaneResizer width={200} onWidth={() => {}} />);

    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-label")).toBe("Resize pane");
    expect(handle.getAttribute("aria-valuenow")).toBe("200");
    expect(handle.getAttribute("aria-valuemin")).toBe(String(PANE_MIN_WIDTH));
    expect(handle.getAttribute("aria-valuemax")).toBe(String(PANE_MAX_WIDTH));
  });

  it("resets to the default width on a double click", async () => {
    const widths: number[] = [];
    const handle = await mount(
      <PaneResizer width={400} onWidth={(w) => widths.push(w)} />,
    );

    fireEvent.doubleClick(handle);
    expect(widths).toEqual([PANE_DEFAULT_WIDTH]);
  });

  it("follows a drag through onResize and keeps the width once, on release", async () => {
    const live: number[] = [];
    const kept: number[] = [];
    const handle = await mount(
      <PaneResizer
        width={200}
        onResize={(w) => live.push(w)}
        onWidth={(w) => kept.push(w)}
      />,
    );

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 });
    // Past the minimum: clamped, so the pane never collapses to nothing.
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 });

    expect(live).toEqual([260, PANE_MIN_WIDTH]);
    expect(kept).toEqual([PANE_MIN_WIDTH]);

    // After the gesture ends, a stray move reports nothing.
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });
    expect(live).toHaveLength(2);
  });

  it("drags the other way for a pane on the right", async () => {
    const kept: number[] = [];
    const handle = await mount(
      <PaneResizer side="left" width={300} onWidth={(w) => kept.push(w)} />,
    );

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 450, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 450, pointerId: 1 });
    expect(kept).toEqual([350]);
  });

  it("steps with the arrow keys", async () => {
    const kept: number[] = [];
    const handle = await mount(
      <PaneResizer width={300} onWidth={(w) => kept.push(w)} />,
    );

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(kept).toEqual([316, 284]);
  });
});
