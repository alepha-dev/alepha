import { describe, it } from "vitest";

import {
  FOLIO_MENUS,
  folioMenuItems,
  folioShortcutBindings,
} from "./folioMenubarModel.ts";

describe("the folio menubar model", () => {
  it("keeps the reading-size group out of the action items", async ({
    expect,
  }) => {
    // The group is a third entry kind beside `{ separator: true }`, and it
    // carries no `FolioActionId`: it writes an atom instead of dispatching.
    // If it leaked into `folioMenuItems()` it would reach
    // `FolioActionHandlers`, which is an exhaustive map, and
    // `folioShortcutBindings()`, which reads `.binding` off every item.
    const view = FOLIO_MENUS.find((menu) => menu.id === "view");
    expect(view?.entries.some((entry) => "radio" in entry)).toBe(true);

    expect(folioMenuItems().some((item) => "radio" in item)).toBe(false);
    expect(folioMenuItems().every((item) => typeof item.id === "string")).toBe(
      true,
    );
  });

  it("binds a shortcut for every item that advertises one", async ({
    expect,
  }) => {
    const bound = folioMenuItems().filter((item) => item.binding);

    expect(folioShortcutBindings().size).toBe(bound.length);
  });
});
