import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FolioActionHandlers } from "../useFolioActions.ts";
import {
  type FolioActionId,
  type FolioActionState,
  folioMenuItems,
} from "./folioMenubarModel.ts";
import { useFolioShortcuts } from "./useFolioShortcuts.ts";

/**
 * The state the empty `/folios` passes: no document, so `noFolio` is the
 * only flag that means anything and `availableWithoutFolio` alone decides
 * what is reachable. Kept in step with `FolioWorkspace`'s own constant.
 */
const NO_FOLIO: FolioActionState = {
  noFolio: true,
  locked: false,
  isNew: false,
  dirty: false,
  isProtected: false,
  isPinned: false,
};

/**
 * An exhaustive handler map that records which ids fired, built off
 * `folioMenuItems()` the same way `FolioWorkspace` builds the real one - so
 * an id added to the model cannot leave this spec with a hole in it.
 */
const recordingHandlers = (): {
  handlers: FolioActionHandlers;
  fired: FolioActionId[];
} => {
  const fired: FolioActionId[] = [];
  const handlers = {} as FolioActionHandlers;
  for (const item of folioMenuItems()) {
    handlers[item.id] = () => {
      fired.push(item.id);
    };
  }
  return { handlers, fired };
};

/**
 * Dispatches a keydown the way a browser would and reports whether anything
 * called `preventDefault()` on it. `cancelable` matters: on a
 * non-cancelable event `preventDefault()` is a silent no-op and
 * `defaultPrevented` stays false, which would make every assertion below
 * pass for the wrong reason.
 */
const pressKey = (
  key: string,
  modifiers: { meta?: boolean; shift?: boolean } = {},
): boolean => {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: modifiers.meta ?? false,
    shiftKey: modifiers.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("useFolioShortcuts", () => {
  it("fires an action available without a folio", () => {
    const { handlers, fired } = recordingHandlers();
    renderHook(() => useFolioShortcuts(handlers, NO_FOLIO, "view"));

    const prevented = pressKey("\\", { meta: true });

    expect(fired).toEqual(["view.tree"]);
    expect(prevented).toBe(true);
  });

  it("leaves the inspector toggle inert with no document open", () => {
    // The empty state mounts no inspector at all - it lives inside
    // `FolioWorkspaceContent`, which that state skips. ⇧⌘\ used to flip a
    // persisted preference with nothing on screen to show for it, so the
    // user found out what they had done on opening the next folio.
    const { handlers, fired } = recordingHandlers();
    renderHook(() => useFolioShortcuts(handlers, NO_FOLIO, "view"));

    const prevented = pressKey("\\", { meta: true, shift: true });

    expect(fired).toEqual([]);
    // Not just unhandled - left alone, so the browser's own behaviour for
    // the combination still applies.
    expect(prevented).toBe(false);
  });

  it("binds nothing while disabled", () => {
    // How `FolioWorkspace` and `FolioDocument` avoid both listening at
    // once, which would dispatch every shortcut twice.
    const { handlers, fired } = recordingHandlers();
    renderHook(() => useFolioShortcuts(handlers, NO_FOLIO, "view", false));

    const prevented = pressKey("\\", { meta: true });

    expect(fired).toEqual([]);
    expect(prevented).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { handlers, fired } = recordingHandlers();
    const view = renderHook(() =>
      useFolioShortcuts(handlers, NO_FOLIO, "view"),
    );

    view.unmount();
    pressKey("\\", { meta: true });

    expect(fired).toEqual([]);
  });

  it("ignores an action the state disables", () => {
    // ⌘S is not `availableWithoutFolio`, so on the empty state it must
    // reach the browser untouched rather than call a no-op handler.
    const { handlers, fired } = recordingHandlers();
    renderHook(() => useFolioShortcuts(handlers, NO_FOLIO, "view"));

    const prevented = pressKey("s", { meta: true });

    expect(fired).toEqual([]);
    expect(prevented).toBe(false);
  });
});
