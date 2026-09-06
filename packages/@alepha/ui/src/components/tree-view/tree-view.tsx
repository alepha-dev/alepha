import { type ReactElement, type ReactNode, useMemo, useRef } from "react";

import type { TreeDropPosition, TreeNode, TreeRow } from "./tree-model.ts";
import { type TreeViewFacade, TreeViewRow } from "./tree-view-row.tsx";

/**
 * A controlled tree: rows in, gestures out.
 *
 * ⚠️ This file is the DECLARATION only. The core lands in #Q1939, drag and
 * drop in #Q1940, rename and the menu slot in #Q1941. Every prop below says
 * which quest implements it.
 *
 * ## The contract, and why it is this one
 *
 * `TreeView` owns the row markup, the indent geometry and the memo. A
 * consumer supplies **render slots** (`renderIcon`, `renderLabel`,
 * `renderTrailing`, `renderMenu`) and turns capabilities on with flags.
 *
 * Render **functions** rather than `ReactNode`s carried on the node, for two
 * measured reasons. Lore's folder icon and the docs tree's folder icon both
 * need the row's collapsed state, which is row state and not node data. And
 * an element built per render changes identity every render, which is
 * exactly what defeats the row memo, while a function called inside the row
 * keeps every row prop a primitive, a memoised node, or a stable function.
 *
 * Stable **by construction**: `TreeView` wraps every callback and render prop
 * into one `useRef`-backed facade (the `implRef` pattern from Lore's
 * `useFolioTreeModel`) and hands rows that. A consumer passing inline arrows
 * still gets a memo that holds, and nobody has to rediscover `useCallback`
 * discipline.
 *
 * A `renderRow` escape hatch was considered and rejected: it hands out the
 * indent geometry and the memo contract, the two things that took the most
 * work and are easiest to break from outside.
 *
 * ## Two constraints for the docs tree, without declaring anything docs-only
 *
 * The label is its **own element**, separate from the row's click handler and
 * from the disclosure button, so rendering it as an anchor one day is a local
 * change rather than a rewrite of the row. `getHref` is deliberately NOT
 * declared: nothing in this epic implements it, and a declared prop that does
 * nothing is a lie in a types file.
 *
 * ARIA tree roles are built into the core (#Q1939) rather than opted into,
 * because they cost nothing and every consumer gains them.
 */

/**
 * What a row knows about itself, handed to every render slot so a consumer
 * can draw a different icon for an open folder, dim a row being dragged, and
 * so on. None of this is node data, which is why the slots are functions of
 * two arguments.
 */
export interface TreeRowState {
  collapsed: boolean;
  selected: boolean;
  renaming: boolean;
  dragging: boolean;
}

export interface TreeViewProps<T = undefined> {
  /**
   * The visible rows, from `flattenTree(nodes, collapsed)`. The tree renders
   * exactly these, in order: it does no filtering of its own.
   */
  rows: TreeRow<T>[];
  /**
   * Ids of the collapsed branches. Controlled, and the same set `rows` was
   * flattened against; the tree reads it to draw the disclosure and to
   * populate {@link TreeRowState.collapsed}.
   */
  collapsed: ReadonlySet<string>;
  /**
   * The selected row, if any. Selection is a prop pair and NOT hook state,
   * on purpose: Lore derives it from the URL, the docs tree will too, and
   * the showcase keeps a `useState` (see #Q1942).
   */
  selectedId?: string;
  /**
   * A row was activated: a plain click, or Enter / Space on a focused row.
   * ⚠️ A real double click fires click, click, dblclick, so the row guards
   * on `e.detail > 1` and this fires once per burst (#Q1939).
   */
  onSelect: (node: TreeNode<T>) => void;
  /**
   * The disclosure of a branch row was clicked. The consumer owns the
   * collapsed set, so the tree reports rather than resolves.
   */
  onToggle: (id: string) => void;
  /**
   * The leading glyph. Colour it here: the tree paints only `--border`,
   * `--primary` and `--muted`, never a palette of its own (#Q1939).
   */
  renderIcon?: (node: TreeNode<T>, state: TreeRowState) => ReactNode;
  /**
   * Defaults to `node.name`. The docs tree will put its dim `.md` suffix
   * here, which a trailing slot cannot do: trailing lands at the far right
   * after `flex-1`, and the suffix belongs against the name.
   */
  renderLabel?: (node: TreeNode<T>, state: TreeRowState) => ReactNode;
  /**
   * The far right of the row, after the label takes its `flex-1`. Lore's pin
   * badge, a count, a hover affordance.
   */
  renderTrailing?: (node: TreeNode<T>, state: TreeRowState) => ReactNode;

  // Drag and drop, #Q1940. Off unless `draggable` is set: a read-only tree
  // must not pay a byte of handler for it.

  /**
   * Turn native HTML5 drag and drop on. #Q1940.
   */
  draggable?: boolean;
  /**
   * The row currently being dragged, if any. The tree also derives "any row
   * of this tree is being dragged" from it, which is a different question
   * from "this row is being dragged" and cannot be answered by the row.
   * #Q1940.
   */
  dragId?: string;
  /**
   * Where the drop marker is drawn right now. #Q1940.
   */
  drop?: { id: string; position: TreeDropPosition };
  /**
   * A drag started on this row. #Q1940.
   */
  onDragStart?: (id: string) => void;
  /**
   * The pointer is over this row, in this zone. A branch splits 28/44/28
   * into before / inside / after; a leaf splits 50/50 with no inside area.
   * #Q1940.
   */
  onDragOver?: (id: string, position: TreeDropPosition) => void;
  /**
   * A drop landed on this row. The tree resolves nothing: the consumer calls
   * `resolveDrop` itself, because only it knows whether the resulting parent
   * change is legal in its own domain. #Q1940.
   */
  onDrop?: (id: string) => void;
  /**
   * The drag ended, dropped or cancelled. #Q1940.
   */
  onDragEnd?: () => void;

  // Rename and the menu slot, #Q1941.

  /**
   * The row showing an inline rename input, if any. The tree owns the draft
   * string; the consumer owns what a committed name means. #Q1941.
   */
  renamingId?: string;
  /**
   * Enter, or a blur that is not an Escape. #Q1941.
   */
  onCommitRename?: (id: string, name: string) => void;
  /**
   * Escape. ⚠️ Removing a focused element from the DOM can still fire
   * `blur` in some browsers, so the row guards the commit rather than
   * trusting the ordering. #Q1941.
   */
  onCancelRename?: () => void;
  /**
   * The context menu's content. Provided, the tree wraps each row in
   * `ContextMenu` / `ContextMenuTrigger`; omitted, it wraps nothing. The
   * verbs are the consumer's: Lore keeps its own 170-line menu and passes it
   * through here. #Q1941.
   */
  renderMenu?: (node: TreeNode<T>) => ReactNode;

  /**
   * Spoken name of the tree, for `role="tree"`. #Q1939.
   */
  label?: string;
  className?: string;
}

/**
 * The controlled tree.
 *
 * Everything is a prop: `rows` (from `flattenTree`), the collapsed set, the
 * selection, and the render slots. The component owns the row markup, the
 * indent geometry, the ARIA structure and the memo, and nothing else.
 *
 * ```tsx
 * <TreeView
 *   rows={flattenTree(nodes, collapsed)}
 *   collapsed={collapsed}
 *   selectedId={openId}
 *   onSelect={(node) => open(node.id)}
 *   onToggle={toggle}
 *   label="Files"
 * />
 * ```
 */
export const TreeView = <T,>(props: TreeViewProps<T>): ReactElement => {
  /**
   * The current props, read through a ref so the facade below can be held
   * forever and still call this render's implementation.
   *
   * Assigned during render on purpose: an effect would leave one render's
   * worth of rows calling last render's callbacks, which is exactly the
   * stale-closure bug the facade exists to avoid.
   */
  const implRef = useRef<TreeViewProps<T>>(props);
  implRef.current = props;

  /**
   * The same slots behind an object whose identity NEVER changes.
   *
   * This is what makes `memo(TreeViewRow)` worth anything, and it is built
   * HERE rather than asked of the consumer: a showcase or an app passing
   * inline arrows would otherwise defeat the memo on its first day, and the
   * failure is invisible (nothing goes red, the tree just re-renders every
   * row on every toggle).
   */
  const facade = useMemo<TreeViewFacade<T>>(
    () => ({
      select: (node) => implRef.current.onSelect(node),
      toggle: (id) => implRef.current.onToggle(id),
      renderIcon: (node, state) => implRef.current.renderIcon?.(node, state),
      renderLabel: (node, state) =>
        implRef.current.renderLabel?.(node, state) ?? node.name,
      renderTrailing: (node, state) =>
        implRef.current.renderTrailing?.(node, state),
      onDragStart: (id) => implRef.current.onDragStart?.(id),
      onDragOver: (id, position) => implRef.current.onDragOver?.(id, position),
      onDrop: (id) => implRef.current.onDrop?.(id),
      onDragEnd: () => implRef.current.onDragEnd?.(),
      commitRename: (id, name) => implRef.current.onCommitRename?.(id, name),
      cancelRename: () => implRef.current.onCancelRename?.(),
      renderMenu: (node) => implRef.current.renderMenu?.(node),
    }),
    [],
  );

  /**
   * Whether ANY row of this tree is being dragged.
   *
   * ⚠️ A different question from "this row is being dragged", and it has to be
   * answered here rather than in a row: a row can compare its own id, but only
   * the tree knows whether the drag exists at all.
   */
  const isDragActive = props.dragId !== undefined;

  return (
    <div role="tree" aria-label={props.label} className={props.className}>
      {props.rows.map((row) => (
        <TreeViewRow
          key={row.node.id}
          node={row.node}
          depth={row.depth}
          facade={facade}
          isCollapsed={props.collapsed.has(row.node.id)}
          isSelected={props.selectedId === row.node.id}
          isRenaming={props.renamingId === row.node.id}
          isDragging={props.dragId === row.node.id}
          isDraggable={props.draggable === true}
          isDragActive={isDragActive}
          dropHere={
            props.drop?.id === row.node.id ? props.drop.position : undefined
          }
          hasMenu={props.renderMenu !== undefined}
        />
      ))}
    </div>
  );
};
