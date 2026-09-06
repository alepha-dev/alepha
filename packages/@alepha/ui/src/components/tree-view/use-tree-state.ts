import { useMemo, useRef, useState } from "react";

import type { TreeDropPosition } from "./tree-model.ts";

export interface UseTreeStateOptions {
  /**
   * Controlled collapse state. Omit for local state.
   *
   * ⚠️ A controlled PAIR rather than an atom, a store or anything this
   * package would have to know about, and it is not a style choice.
   *
   * Collapse state can outlive the hook. A consumer whose layout renders two
   * different component types in the same position by route tears the whole
   * tree down and rebuilds it on navigation, and an `initializedRef` guard
   * survives re-renders but not that: the one-time seed runs again and
   * re-collapses everything the reader had opened. Holding the pair outside
   * the hook is what makes the state survive, and a parent's `useState`, a
   * URL, or an atom all satisfy it identically.
   */
  collapsed?: [ReadonlySet<string>, (next: ReadonlySet<string>) => void];
  /**
   * Seed for `renamingId`, read once at mount. For a consumer that creates a
   * node and navigates in the same gesture, where the new row has to open
   * straight into rename on the other side of the navigation.
   */
  initialRenamingId?: string;
  onRename: (id: string, name: string) => void | Promise<void>;
  /**
   * A legal-looking drop landed. The consumer calls `resolveDrop` itself,
   * because only it knows whether the resulting parent change is legal in
   * its own domain, and what to write.
   */
  onMove: (
    dragId: string,
    targetId: string,
    position: TreeDropPosition,
  ) => void | Promise<void>;
}

export interface TreeStateCommands {
  toggle: (id: string) => void;
  /**
   * Expand exactly this branch, never its ancestors. For the moment after
   * creating a child inside it: the parent's own row could only have been
   * acted on while visible, so its ancestors are already open and only the
   * parent itself might be closed.
   */
  expandOne: (id?: string) => void;
  beginRename: (id: string) => void;
  cancelRename: () => void;
  commitRename: (id: string, name: string) => void | Promise<void>;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, position: TreeDropPosition) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string) => void | Promise<void>;
}

export interface TreeState {
  collapsed: ReadonlySet<string>;
  renamingId?: string;
  dragId?: string;
  drop?: { id: string; position: TreeDropPosition };
  /**
   * ⚠️ Identity NEVER changes for the life of the hook. See the facade block
   * at the bottom of this file.
   */
  commands: TreeStateCommands;
}

/**
 * The state a `TreeView` needs and a consumer would otherwise write again:
 * collapse, inline rename, the drag gesture and the drop guard.
 *
 * **Selection is deliberately not here.** No two consumers hold it the same
 * way (one derives it from the URL, another from local state), so a hook that
 * owned it would need a controlled/uncontrolled pair for a value it can never
 * be the source of. `TreeView` takes `selectedId` and `onSelect` directly.
 *
 * Neither is anything that needs to know what an ancestor means in the
 * consumer's URL space: auto-expanding the branches above the selected node,
 * revealing a node by some other identifier, seeding the initial collapse set.
 * Those stay with the consumer, and `expandOne` plus the controlled pair is
 * everything they need from here.
 */
export const useTreeState = (options: UseTreeStateOptions): TreeState => {
  const [localCollapsed, setLocalCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const collapsed = options.collapsed?.[0] ?? localCollapsed;
  const writeCollapsed = options.collapsed?.[1] ?? setLocalCollapsed;

  // Read once, at mount: a hand-off consumed on a later render would fire
  // against whatever row happened to exist then.
  const [renamingId, setRenamingId] = useState<string | undefined>(
    () => options.initialRenamingId,
  );
  const [dragId, setDragId] = useState<string | undefined>();
  const [drop, setDrop] = useState<
    { id: string; position: TreeDropPosition } | undefined
  >();

  const toggle = (id: string): void => {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    writeCollapsed(next);
  };

  const expandOne = (id?: string): void => {
    if (!id || !collapsed.has(id)) return;
    const next = new Set(collapsed);
    next.delete(id);
    writeCollapsed(next);
  };

  const commitRename = async (id: string, name: string): Promise<void> => {
    await options.onRename(id, name);
    setRenamingId(undefined);
  };

  const onDrop = async (targetId: string): Promise<void> => {
    const currentDragId = dragId;
    // Trust `targetId` (the row whose own `onDrop` fired) paired with
    // `drop` ONLY when the two agree on which row that is. Guards against a
    // stale `drop` left by a row the pointer passed over earlier, if the
    // browser's dragover/drop ordering ever disagrees.
    const position = drop && drop.id === targetId ? drop.position : undefined;
    setDragId(undefined);
    setDrop(undefined);
    if (!currentDragId || !position) return;
    await options.onMove(currentDragId, targetId, position);
  };

  /**
   * The current implementation of every command, rebuilt on each render
   * because each one closes over this render's state. Assigned during render
   * rather than in an effect: an effect would leave one render's worth of
   * rows calling last render's callbacks.
   */
  const implRef = useRef<TreeStateCommands>(undefined as never);
  implRef.current = {
    toggle,
    expandOne,
    beginRename: (id) => setRenamingId(id),
    cancelRename: () => setRenamingId(undefined),
    commitRename,
    onDragStart: (id) => setDragId(id),
    onDragOver: (id, position) => setDrop({ id, position }),
    onDragEnd: () => {
      setDragId(undefined);
      setDrop(undefined);
    },
    onDrop,
  };

  /**
   * The same commands behind a facade whose identity NEVER changes.
   *
   * A facade rather than `useCallback` on each command, because most of them
   * legitimately change when the data changes and a consumer holding last
   * render's copy would act on a stale set. Reading through the ref means the
   * object can be held forever and still call the current implementation.
   *
   * ⚠️ Not a micro-optimisation. An effect depending on a rebuilt command
   * object re-runs, sets parent state, re-renders, rebuilds the object: a
   * live "Maximum update depth exceeded" that had to be worked around with a
   * ref until the stable facade removed the need.
   */
  const commands = useMemo<TreeStateCommands>(
    () => ({
      toggle: (id) => implRef.current.toggle(id),
      expandOne: (id) => implRef.current.expandOne(id),
      beginRename: (id) => implRef.current.beginRename(id),
      cancelRename: () => implRef.current.cancelRename(),
      commitRename: (id, name) => implRef.current.commitRename(id, name),
      onDragStart: (id) => implRef.current.onDragStart(id),
      onDragOver: (id, position) => implRef.current.onDragOver(id, position),
      onDragEnd: () => implRef.current.onDragEnd(),
      onDrop: (targetId) => implRef.current.onDrop(targetId),
    }),
    [],
  );

  return { collapsed, renamingId, dragId, drop, commands };
};
