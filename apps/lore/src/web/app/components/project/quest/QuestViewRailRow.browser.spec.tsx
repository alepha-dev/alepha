import { cleanup, render } from "@testing-library/react";
import { Signature } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import QuestViewRailRow from "./QuestViewRailRow.tsx";

/**
 * The rail row centres its value against its label (#1753, feedback #2083).
 *
 * Most values are plain text the same height as the label, so `items-start`
 * looked right for as long as nobody put a control in one. Assigned renders
 * an avatar chip and Release a select trigger with a chevron; on both, the
 * label sat pinned to the top of a box the value filled.
 *
 * ⚠️ jsdom does no layout, so this can only pin the class - and a class is
 * the whole of the change. The measurements are from Chrome, on a quest
 * carrying all six rows: with `items-start` the label's centre sat 3px above
 * the row's on Assigned, 4px on Release and 8px on a wrapped Area, and every
 * plain row was already at 0 and stayed there.
 */
describe("QuestViewRailRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("centres the row so a taller value does not push its label up", () => {
    const { container } = render(
      <QuestViewRailRow icon={Signature} label="Assigned">
        <span>Unassigned</span>
      </QuestViewRailRow>,
    );

    const row = container.firstElementChild;

    expect(row?.className).toContain("items-center");
    expect(row?.className).not.toContain("items-start");
  });

  /**
   * The row is absent, not empty, when there is no value: the rail never
   * shows a label waiting for data that is not coming.
   */
  it("renders nothing without a value", () => {
    const { container } = render(
      <QuestViewRailRow icon={Signature} label="Release" />,
    );

    expect(container.firstElementChild).toBeNull();
  });
});
