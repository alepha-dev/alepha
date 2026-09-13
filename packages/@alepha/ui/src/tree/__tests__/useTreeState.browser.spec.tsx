import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { TreeDropPosition } from "../tree-model.ts";
import { useTreeState } from "../use-tree-state.ts";

const noop = () => {};

describe("useTreeState", () => {
  it("toggles a branch closed and open again", () => {
    const { result } = renderHook(() =>
      useTreeState({ onRename: noop, onMove: noop }),
    );

    act(() => result.current.commands.toggle("a"));
    expect([...result.current.collapsed]).toEqual(["a"]);

    act(() => result.current.commands.toggle("a"));
    expect([...result.current.collapsed]).toEqual([]);
  });

  it("expands exactly one branch, and only when it is closed", () => {
    const { result } = renderHook(() =>
      useTreeState({ onRename: noop, onMove: noop }),
    );

    act(() => result.current.commands.toggle("a"));
    act(() => result.current.commands.toggle("b"));

    act(() => result.current.commands.expandOne("a"));
    expect([...result.current.collapsed]).toEqual(["b"]);

    // Already open, and undefined: both are no-ops rather than errors.
    act(() => result.current.commands.expandOne("a"));
    act(() => result.current.commands.expandOne(undefined));
    expect([...result.current.collapsed]).toEqual(["b"]);
  });

  it("writes through a controlled pair rather than owning the set", () => {
    const writes: string[][] = [];
    let held: ReadonlySet<string> = new Set(["seed"]);
    const { result, rerender } = renderHook(() =>
      useTreeState({
        collapsed: [
          held,
          (next) => {
            held = next;
            writes.push([...next]);
          },
        ],
        onRename: noop,
        onMove: noop,
      }),
    );

    expect([...result.current.collapsed]).toEqual(["seed"]);

    act(() => result.current.commands.toggle("a"));
    expect(writes).toEqual([["seed", "a"]]);

    rerender();
    expect([...result.current.collapsed]).toEqual(["seed", "a"]);
  });

  it("keeps collapse across an unmount when the pair is held outside", () => {
    // ⚠️ The failure this is against: a consumer whose layout renders two
    // different component types in the same position by route tears the
    // tree down on navigation, and state owned by the hook goes with it.
    let held: ReadonlySet<string> = new Set();
    const options = {
      collapsed: [held, (next: ReadonlySet<string>) => (held = next)] as [
        ReadonlySet<string>,
        (next: ReadonlySet<string>) => void,
      ],
      onRename: noop,
      onMove: noop,
    };

    const first = renderHook(() => useTreeState(options));
    act(() => first.result.current.commands.toggle("a"));
    first.unmount();

    expect([...held]).toEqual(["a"]);

    const second = renderHook(() =>
      useTreeState({ ...options, collapsed: [held, () => {}] }),
    );
    expect([...second.result.current.collapsed]).toEqual(["a"]);
  });

  it("owns collapse locally when no pair is given, and loses it on unmount", () => {
    // The other side of the same coin, stated so the trade is visible: an
    // uncontrolled tree is the simple case and does not survive a remount.
    const first = renderHook(() =>
      useTreeState({ onRename: noop, onMove: noop }),
    );
    act(() => first.result.current.commands.toggle("a"));
    expect([...first.result.current.collapsed]).toEqual(["a"]);
    first.unmount();

    const second = renderHook(() =>
      useTreeState({ onRename: noop, onMove: noop }),
    );
    expect([...second.result.current.collapsed]).toEqual([]);
  });

  it("runs the rename lifecycle, seed included", async () => {
    const renamed: [string, string][] = [];
    const { result } = renderHook(() =>
      useTreeState({
        initialRenamingId: "seeded",
        onRename: (id, name) => {
          renamed.push([id, name]);
        },
        onMove: noop,
      }),
    );

    // The hand-off is read once, at mount.
    expect(result.current.renamingId).toBe("seeded");

    act(() => result.current.commands.cancelRename());
    expect(result.current.renamingId).toBeUndefined();

    act(() => result.current.commands.beginRename("a"));
    expect(result.current.renamingId).toBe("a");

    await act(async () => {
      await result.current.commands.commitRename("a", "Renamed");
    });
    expect(renamed).toEqual([["a", "Renamed"]]);
    // Cleared only AFTER the consumer's write resolves.
    expect(result.current.renamingId).toBeUndefined();
  });

  it("moves only when drop and target agree on which row it is", async () => {
    const moved: [string, string, TreeDropPosition][] = [];
    const { result } = renderHook(() =>
      useTreeState({
        onRename: noop,
        onMove: (dragId, targetId, position) => {
          moved.push([dragId, targetId, position]);
        },
      }),
    );

    act(() => result.current.commands.onDragStart("a"));
    act(() => result.current.commands.onDragOver("b", "inside"));
    expect(result.current.dragId).toBe("a");
    expect(result.current.drop).toEqual({ id: "b", position: "inside" });

    await act(async () => {
      await result.current.commands.onDrop("b");
    });
    expect(moved).toEqual([["a", "b", "inside"]]);
    expect(result.current.dragId).toBeUndefined();
    expect(result.current.drop).toBeUndefined();
  });

  it("refuses a drop whose target is not the row the marker was on", async () => {
    // A stale `drop` left by a row the pointer passed over earlier. Without
    // the guard the move lands on the wrong parent, silently.
    const moved: string[] = [];
    const { result } = renderHook(() =>
      useTreeState({
        onRename: noop,
        onMove: (_d, targetId) => {
          moved.push(targetId);
        },
      }),
    );

    act(() => result.current.commands.onDragStart("a"));
    act(() => result.current.commands.onDragOver("b", "inside"));

    await act(async () => {
      await result.current.commands.onDrop("c");
    });
    expect(moved).toEqual([]);
    // The gesture is still cleared: a refused drop must not leave the tree
    // looking mid-drag.
    expect(result.current.dragId).toBeUndefined();
    expect(result.current.drop).toBeUndefined();
  });

  it("refuses a drop with no drag behind it", async () => {
    const moved: string[] = [];
    const { result } = renderHook(() =>
      useTreeState({
        onRename: noop,
        onMove: (_d, targetId) => {
          moved.push(targetId);
        },
      }),
    );

    await act(async () => {
      await result.current.commands.onDrop("b");
    });
    expect(moved).toEqual([]);
  });

  it("clears the gesture on dragEnd", () => {
    const { result } = renderHook(() =>
      useTreeState({ onRename: noop, onMove: noop }),
    );

    act(() => result.current.commands.onDragStart("a"));
    act(() => result.current.commands.onDragOver("b", "after"));
    act(() => result.current.commands.onDragEnd());

    expect(result.current.dragId).toBeUndefined();
    expect(result.current.drop).toBeUndefined();
  });

  it("keeps one command object for the life of the hook", () => {
    // ⚠️ The whole point. Every command closes over this render's state, so
    // their implementations change identity every render; the object a row
    // holds must not, or the row memo can never hold.
    const { result } = renderHook(() => {
      const [, force] = useState(0);
      const state = useTreeState({ onRename: noop, onMove: noop });
      return { state, force };
    });

    const first = result.current.state.commands;

    act(() => result.current.state.commands.toggle("a"));
    act(() => result.current.force(1));

    expect(result.current.state.commands).toBe(first);
    // And it still calls the CURRENT implementation, not the one it closed
    // over at mount.
    act(() => first.toggle("a"));
    expect([...result.current.state.collapsed]).toEqual([]);
  });
});
