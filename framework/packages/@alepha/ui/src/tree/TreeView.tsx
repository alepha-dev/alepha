import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { inlineArrowKey } from "../core/inlineArrowKey.ts";
import {
  TREE_ROOT_ID,
  type TreeDropPosition,
  type TreeNode,
  type TreeRow,
} from "./treeModel.ts";
import {
  type TreeSelectOptions,
  type TreeViewFacade,
  TreeViewRow,
} from "./TreeViewRow.tsx";

/**
 * A controlled tree: rows in, gestures out.
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
   * More selected rows, drawn as selected beside {@link selectedId}: a
   * range picked with shift (#Q3654). Like `selectedId`, the consumer owns
   * it; the tree only reports the shift on {@link onSelect}. Setting it
   * marks the tree `aria-multiselectable`.
   */
  selectedIds?: ReadonlySet<string>;
  /**
   * A row was activated: a plain click, or Enter / Space on a focused row.
   * ⚠️ A real double click fires click, click, dblclick, so the row guards
   * on `e.detail > 1` and this fires once per burst (#Q1939). `options.shift`
   * says Shift was held, for a tree that selects a range.
   */
  onSelect: (node: TreeNode<T>, options?: TreeSelectOptions) => void;
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
   * The row the pointer is over during a drag (or {@link TREE_ROOT_ID}), as
   * `onDragOver` reported it. The tree highlights the FOLDER it targets,
   * as a file manager does: the branch itself, or a leaf's parent, and all
   * of that folder's rows. #Q1940.
   */
  drop?: { id: string; position: TreeDropPosition };
  /**
   * A drag started on this row. #Q1940.
   */
  onDragStart?: (id: string) => void;
  /**
   * The pointer is over this row: `inside` on a branch, `before` on a leaf,
   * which `resolveDrop` reads as "into the folder that holds it". The tree is
   * sorted by its comparator, so there is no place BETWEEN two rows to drop
   * on: the 28/44/28 zones and their before / after lines promised one. #Q1940.
   */
  onDragOver?: (id: string, position: TreeDropPosition) => void;
  /**
   * A drop landed on this row. The tree resolves nothing: the consumer calls
   * `resolveDrop` itself, because only it knows whether the resulting parent
   * change is legal in its own domain. #Q1940.
   */
  onDrop?: (id: string) => void;
  /**
   * Files from the operating system were dropped on a row. Without it a file
   * drag is refused, as it always was. With it the row accepts the drag
   * (`dropEffect: "copy"`) and hands the files over with the row's id: a
   * consumer decides what a file landing on a leaf means (its parent, say).
   */
  onFilesDrop?: (id: string, files: File[]) => void;
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
  /**
   * The row that last took the focus: the tree's one tab stop. Falls back to
   * the selected row, then the first, when it is gone or was never set.
   */
  const [focusedId, setFocusedId] = useState<string>();
  const tabStopId =
    (focusedId !== undefined &&
      props.rows.some((row) => row.node.id === focusedId) &&
      focusedId) ||
    (props.selectedId !== undefined &&
      props.rows.some((row) => row.node.id === props.selectedId) &&
      props.selectedId) ||
    props.rows[0]?.node.id;

  /**
   * The keyboard contract `role="tree"` claims, on the flat list of rows:
   * Up and Down move one row, Home and End to the ends, Right opens a closed
   * branch or steps into an open one, Left closes an open branch or steps
   * out to the parent. Enter and Space stay the row's own (select). On a
   * right-to-left page Right and Left swap (`inlineArrowKey`).
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") !== "treeitem") return;
    const elements = [
      ...e.currentTarget.querySelectorAll<HTMLElement>(
        '[data-slot="tree-view-row"]',
      ),
    ];
    const index = elements.indexOf(target);
    const row = props.rows[index];
    if (!row) return;
    const isOpenBranch =
      row.node.branch === true && !props.collapsed.has(row.node.id);
    let next: number | undefined;
    // Right opens and steps in, Left closes and steps out: swapped on a
    // right-to-left page, where a branch's children sit to its left.
    switch (inlineArrowKey(e)) {
      case "ArrowDown":
        next = index + 1;
        break;
      case "ArrowUp":
        next = index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = elements.length - 1;
        break;
      case "ArrowRight":
        if (row.node.branch && !isOpenBranch) {
          e.preventDefault();
          facade.toggle(row.node.id);
          return;
        }
        if (isOpenBranch && (props.rows[index + 1]?.depth ?? -1) > row.depth) {
          next = index + 1;
        }
        break;
      case "ArrowLeft":
        if (isOpenBranch) {
          e.preventDefault();
          facade.toggle(row.node.id);
          return;
        }
        for (let i = index - 1; i >= 0; i--) {
          if (props.rows[i]!.depth < row.depth) {
            next = i;
            break;
          }
        }
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== undefined) elements[next]?.focus();
  };

  const facade = useMemo<TreeViewFacade<T>>(
    () => ({
      select: (node, options) => implRef.current.onSelect(node, options),
      toggle: (id) => implRef.current.onToggle(id),
      renderIcon: (node, state) => implRef.current.renderIcon?.(node, state),
      renderLabel: (node, state) =>
        implRef.current.renderLabel?.(node, state) ?? node.name,
      renderTrailing: (node, state) =>
        implRef.current.renderTrailing?.(node, state),
      onDragStart: (id) => implRef.current.onDragStart?.(id),
      onDragOver: (id, position) => implRef.current.onDragOver?.(id, position),
      onDrop: (id) => implRef.current.onDrop?.(id),
      acceptsFiles: () => implRef.current.onFilesDrop !== undefined,
      onFilesDrop: (id, files) => implRef.current.onFilesDrop?.(id, files),
      onDragEnd: () => implRef.current.onDragEnd?.(),
      commitRename: (id, name) => implRef.current.onCommitRename?.(id, name),
      cancelRename: () => implRef.current.onCancelRename?.(),
      renderMenu: (node) => implRef.current.renderMenu?.(node),
      focus: (id) => setFocusedId(id),
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

  /**
   * The dragged node and everything beneath it.
   *
   * ⚠️ The one legality question this component answers on its own, and it
   * has to: dropping a branch inside its own subtree would orphan the branch,
   * which is a fact about the TREE and not about the consumer's domain. The
   * consumer's `resolveDrop` refuses such a drop at the end anyway, so without
   * this the row would light up promising a move that never happens.
   *
   * Computed once per render as a SET rather than asking `nodeHolds` per row,
   * so a drag over a large tree stays one walk of the dragged subtree.
   */
  const forbidden = useMemo(() => {
    const ids = new Set<string>();
    if (props.dragId === undefined) return ids;
    const dragged = props.rows.find(
      (row) => row.node.id === props.dragId,
    )?.node;
    if (!dragged) return ids;
    const walk = (node: TreeNode<T>): void => {
      ids.add(node.id);
      for (const child of node.children ?? []) walk(child);
    };
    walk(dragged);
    return ids;
  }, [props.dragId, props.rows]);

  /**
   * Where a drop over each row would land, and whether it means anything.
   *
   * A row's folder is the branch itself or a leaf's parent (`null` for the
   * root). A drop there is REFUSED (no highlight, the "no drop" cursor) when
   * it is the dragged node's own folder, since a sorted tree would put it
   * back where it was, or inside the dragged branch's subtree.
   */
  const drag = useMemo(() => {
    const byId = new Map(props.rows.map((row) => [row.node.id, row.node]));
    const dragged =
      props.dragId === undefined ? undefined : byId.get(props.dragId);
    const draggedParent = dragged
      ? (dragged.declaredParentId ?? dragged.parentId ?? null)
      : undefined;
    const containerOf = (id: string): string | null | undefined => {
      if (id === TREE_ROOT_ID) return null;
      const node = byId.get(id);
      if (!node) return undefined;
      return node.branch ? node.id : (node.parentId ?? null);
    };
    const allows = (container: string | null | undefined): boolean =>
      dragged !== undefined &&
      container !== undefined &&
      container !== draggedParent &&
      (container === null || !forbidden.has(container));
    return { byId, containerOf, allows };
  }, [props.dragId, props.rows, forbidden]);

  // The folder the current drop targets, when the drop would do something.
  const target = props.drop ? drag.containerOf(props.drop.id) : undefined;
  const targetAllowed = drag.allows(target);

  // Its rows: the folder's own row and everything beneath it that is shown.
  const block = useMemo(() => {
    const ids = new Set<string>();
    if (!targetAllowed || typeof target !== "string") return ids;
    const walk = (node: TreeNode<T>): void => {
      ids.add(node.id);
      for (const child of node.children ?? []) walk(child);
    };
    const folder = drag.byId.get(target);
    if (folder) walk(folder);
    return ids;
  }, [target, targetAllowed, drag]);

  // A closed folder held under the pointer opens, so a drop can go deep in
  // one gesture (as in a file manager). Only while a drag is on.
  const opensAfterHover = targetAllowed && typeof target === "string";
  const hoveredClosed =
    opensAfterHover && props.drop?.id === target && props.collapsed.has(target);
  useEffect(() => {
    if (!hoveredClosed || typeof target !== "string") return;
    const timer = setTimeout(() => facade.toggle(target), 600);
    return () => clearTimeout(timer);
  }, [hoveredClosed, target, facade]);

  return (
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- a roving tab stop: the rows take the focus, the tree only hears their arrow keys
    <div
      role="tree"
      aria-label={props.label}
      aria-multiselectable={props.selectedIds ? true : undefined}
      className={props.className}
      // The root is the target. Flagged rather than painted: the pane around
      // the tree (and its empty space below the rows) is the root folder,
      // and only the consumer draws that.
      data-drop-root={targetAllowed && target === null ? "" : undefined}
      onKeyDown={onKeyDown}
    >
      {props.rows.map((row) => (
        <TreeViewRow
          key={row.node.id}
          node={row.node}
          depth={row.depth}
          facade={facade}
          isCollapsed={props.collapsed.has(row.node.id)}
          isSelected={
            props.selectedId === row.node.id ||
            props.selectedIds?.has(row.node.id) === true
          }
          isRenaming={props.renamingId === row.node.id}
          isDragging={props.dragId === row.node.id}
          isDraggable={props.draggable === true}
          isDragActive={isDragActive}
          dropAllowed={drag.allows(drag.containerOf(row.node.id))}
          inDropBlock={block.has(row.node.id)}
          hasMenu={props.renderMenu !== undefined}
          isTabStop={row.node.id === tabStopId}
        />
      ))}
    </div>
  );
};
