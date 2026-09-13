import {
  ContextMenu,
  ContextMenuTrigger,
} from "@alepha/ui/components/ui/context-menu";
import { cn } from "@alepha/ui/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import type { TreeDropPosition, TreeNode } from "./tree-model.ts";
import { TreeViewRenameInput } from "./tree-view-rename-input.tsx";
import type { TreeRowState } from "./tree-view.tsx";

/**
 * The slots and callbacks a row reads, behind an object whose identity never
 * changes for the life of the tree.
 *
 * ⚠️ Rows never receive a raw consumer callback. `TreeView` builds this once
 * (see its `implRef` block) so a consumer passing inline arrows still gets a
 * memo that holds. Every method here reads through that ref, so it can be
 * held forever and still call the current implementation.
 */
export interface TreeViewFacade<T = undefined> {
  select: (node: TreeNode<T>) => void;
  toggle: (id: string) => void;
  renderIcon: (node: TreeNode<T>, state: TreeRowState) => ReactNode;
  renderLabel: (node: TreeNode<T>, state: TreeRowState) => ReactNode;
  renderTrailing: (node: TreeNode<T>, state: TreeRowState) => ReactNode;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, position: TreeDropPosition) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
  commitRename: (id: string, name: string) => void;
  cancelRename: () => void;
  renderMenu: (node: TreeNode<T>) => ReactNode;
}

export interface TreeViewRowProps<T = undefined> {
  node: TreeNode<T>;
  depth: number;
  /**
   * Stable for the life of the tree, which is what lets this component be
   * memoised at all. See {@link TreeViewFacade}.
   */
  facade: TreeViewFacade<T>;
  /**
   * The state flags are passed as PRIMITIVES rather than derived from the
   * tree state here. That is the whole reason the memo below holds: a toggle
   * changes `rows` and `collapsed`, so any prop carrying the state object
   * would change identity on every row.
   */
  isCollapsed: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  isDragging: boolean;
  /**
   * Whether this tree has drag and drop turned on. Off, the row attaches no
   * drag handler at all: a read-only tree must not pay for a capability it
   * never uses.
   */
  isDraggable: boolean;
  /**
   * Whether ANY row of this tree is being dragged, which is not the same
   * question as {@link TreeViewRowProps.isDragging}. `handleDragOver` needs it
   * to tell an internal drag from an external one that carries no files.
   */
  isDragActive: boolean;
  /**
   * Where this row's drop marker is drawn, if the pointer is over it.
   */
  dropHere?: TreeDropPosition;
  /**
   * This row is the dragged node or sits beneath it, so a drop here would
   * orphan the branch and will be refused. The row still REPORTS the zone, so
   * the marker follows the pointer rather than sticking to the last legal row,
   * but it draws nothing: a marker promising a move that will not happen is
   * worse than no marker at all.
   */
  isDropForbidden: boolean;
  /**
   * Whether the consumer supplied a `renderMenu` slot. A primitive rather than
   * the slot itself, so the memo still holds: the slot travels on the facade.
   */
  hasMenu: boolean;
}

/**
 * One row of a `TreeView`: the disclosure column (a chevron on a branch, a
 * spacer on a leaf), the icon slot, the label, and the trailing slot, over the
 * indent geometry.
 *
 * ## Drag and drop, and why it is native rather than @dnd-kit
 *
 * `@dnd-kit` is the house drag library in the applications that consume this
 * package (kanban boards, file browsers), and it is the wrong tool **here
 * specifically**. Three drop zones per row is about forty lines of
 * `onDragOver` arithmetic natively, against writing custom collision detection
 * for a library built around a single drop target per area. Recorded so it is
 * not re-litigated.
 *
 * A branch row splits **28% / 44% / 28%** into before / inside / after. A leaf
 * splits 50/50 with no inside area, because it cannot hold children.
 *
 * The row reports gestures and resolves nothing: `resolveDrop` is the
 * consumer's to call, because only it knows whether the resulting parent
 * change is legal in its own domain.
 *
 * ## Inline rename, and the context menu as a SLOT
 *
 * A row in rename mode swaps its label for {@link TreeViewRenameInput}. The
 * verbs of the context menu are never this component's business: it takes a
 * `renderMenu` slot and wraps the row in `ContextMenu` only when one is
 * given, so a consumer keeps its own menu with its own routes.
 */
const TreeViewRowImpl = <T,>(props: TreeViewRowProps<T>): ReactElement => {
  const { node, depth, facade, isCollapsed, isSelected } = props;
  const state: TreeRowState = {
    collapsed: isCollapsed,
    selected: isSelected,
    renaming: props.isRenaming,
    dragging: props.isDragging,
  };

  /**
   * One gesture, one meaning: a click opens the row it is on.
   *
   * ⚠️ The `e.detail > 1` guard is not optional. A real double click fires
   * click, click, then dblclick, so without it the two clicks toggle a
   * branch twice and it ends collapsed: a different outcome from the single
   * click that shares its first half, reached by doing the same thing
   * faster. It costs no timer and no latency, since `detail` is the
   * browser's own counter for the burst and is already on the event.
   */
  const handleClick = (e: MouseEvent): void => {
    if (props.isRenaming) return;
    if (e.detail > 1) return;
    facade.select(node);
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (props.isRenaming) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    facade.select(node);
  };

  const handleToggle = (e: MouseEvent): void => {
    e.stopPropagation();
    facade.toggle(node.id);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
    facade.onDragStart(node.id);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    if (isFileDrag(e)) {
      // An OS file drag has nowhere to land in a tree of rows, so refuse it
      // rather than silently treating it as a re-parent.
      e.dataTransfer.dropEffect = "none";
      return;
    }
    if (!props.isDragActive || props.isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const position: TreeDropPosition = node.branch
      ? y < rect.height * 0.28
        ? "before"
        : y > rect.height * 0.72
          ? "after"
          : "inside"
      : y < rect.height / 2
        ? "before"
        : "after";
    facade.onDragOver(node.id, position);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    if (isFileDrag(e)) return;
    facade.onDrop(node.id);
  };

  // The row's own attributes, built once: the same element is rendered
  // directly, or handed to `ContextMenuTrigger`'s `render` prop when the
  // consumer supplied a menu. Duplicating the list for the two branches is
  // exactly how the two would drift.
  const rowProps = {
    "data-slot": "tree-view-row",
    role: "treeitem",
    // The rows are a flat list rather than nested `role="group"` elements,
    // so depth is spoken through `aria-level`, which is the flat
    // equivalent.
    "aria-level": depth + 1,
    "aria-expanded": node.branch ? !isCollapsed : undefined,
    "aria-selected": isSelected || undefined,
    tabIndex: 0,
    // Selection is otherwise only a background class, which is not
    // something a test (or a future stylesheet) can address.
    "data-selected": isSelected || undefined,
    draggable: props.isDraggable && !props.isRenaming,
    onDragStart: props.isDraggable ? handleDragStart : undefined,
    onDragOver: props.isDraggable ? handleDragOver : undefined,
    onDrop: props.isDraggable ? handleDrop : undefined,
    onDragEnd: props.isDraggable ? facade.onDragEnd : undefined,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
    className: cn(
      // `group/tree-row` is NAMED, not a bare `group`: a consumer's icon
      // slot tracks this row's hover and selected background through it,
      // and a bare group here would also be captured by any `group-*`
      // utility inside the parts nested below.
      "group/tree-row hover:bg-muted/60 relative flex cursor-default items-center gap-1 py-1 pr-2 text-sm outline-none select-none",
      // ⚠️ Named properties, never `transition-all`. This element is
      // also an HTML5 drag SOURCE that animates `opacity` while dragging
      // and carries the drop markers; a blanket transition puts all
      // three on a timer, so the drop indicator lags the pointer it is
      // supposed to track.
      "transition-[background-color,transform] duration-150",
      // The press. Suppressed while dragging, because a transform on a
      // drag source moves the browser's own drag image with it.
      !props.isDragging && !props.isRenaming && "active:translate-y-px",
      "focus-visible:bg-muted/60",
      isSelected && "bg-muted font-medium",
      props.isDragging && "opacity-45",
      props.dropHere === "inside" &&
        !props.isDropForbidden &&
        "bg-primary/10 ring-primary/60 ring-1 ring-inset",
    ),
    style: {
      paddingLeft: `${INDENT_BASE_PX + depth * INDENT_STEP_PX}px`,
      // Indent guides, as pure CSS: one hairline per ancestor level,
      // painted as a repeating gradient clipped to the indent area so it
      // can never run under the label. A background IMAGE, so the row's
      // background COLOUR (hover, selection) still shows through
      // underneath.
      ...(depth > 0 && {
        backgroundImage:
          "repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px " +
          `${INDENT_STEP_PX}px)`,
        backgroundPosition: `${INDENT_GUIDE_ORIGIN_PX}px 0`,
        backgroundSize: `${depth * INDENT_STEP_PX}px 100%`,
        backgroundRepeat: "no-repeat",
      }),
    },
  };

  const content = (
    <>
      {isSelected && (
        // The accent bar. A selected row used to differ from its
        // neighbours by a background tint alone, which several themes
        // render almost invisibly.
        <span
          aria-hidden
          className="bg-primary pointer-events-none absolute inset-y-0 left-0 w-0.5"
        />
      )}
      {props.dropHere === "before" && !props.isDropForbidden && (
        <div
          data-slot="tree-view-drop-before"
          className="bg-primary pointer-events-none absolute inset-x-0 top-0 h-0.5"
        />
      )}
      {props.dropHere === "after" && !props.isDropForbidden && (
        <div
          data-slot="tree-view-drop-after"
          className="bg-primary pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
        />
      )}
      {node.branch ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={handleToggle}
          className="flex h-3.5 shrink-0 items-center justify-center"
          style={{ width: DISCLOSURE_BOX_PX }}
        >
          {isCollapsed ? (
            <ChevronRight className="size-3 opacity-60" />
          ) : (
            <ChevronDown className="size-3 opacity-60" />
          )}
        </button>
      ) : (
        <span
          className="inline-block shrink-0"
          style={{ width: DISCLOSURE_BOX_PX }}
        />
      )}
      {facade.renderIcon(node, state)}
      {props.isRenaming ? (
        <TreeViewRenameInput
          name={node.name}
          onCommit={(name) => facade.commitRename(node.id, name)}
          onCancel={facade.cancelRename}
        />
      ) : (
        /*
         * The label is its OWN element, separate from the row's click
         * handler and from the disclosure button, so a consumer that needs
         * an anchor here one day changes this line rather than the row.
         */
        <span data-slot="tree-view-label" className="min-w-0 flex-1 truncate">
          {facade.renderLabel(node, state)}
        </span>
      )}
      {!props.isRenaming && facade.renderTrailing(node, state)}
    </>
  );

  if (!props.hasMenu) return <div {...rowProps}>{content}</div>;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div {...rowProps} />}>
        {content}
      </ContextMenuTrigger>
      {facade.renderMenu(node)}
    </ContextMenu>
  );
};

/**
 * How far one level of nesting indents a row, in pixels.
 *
 * Shared by the row's own left padding and by the indent guides drawn behind
 * it, so the two cannot drift: a guide that does not line up with the column
 * it belongs to is worse than no guide.
 */
export const INDENT_STEP_PX = 13;

/**
 * The row's own base padding: where a depth-0 row's content starts.
 */
export const INDENT_BASE_PX = 8;

/**
 * The width of the disclosure column: the chevron button on a branch, and the
 * spacer that stands in for it on a leaf.
 *
 * Applied as a style rather than a `w-3.5` class **on purpose**: it is also
 * half of {@link INDENT_GUIDE_ORIGIN_PX}, so a class here would let the box be
 * resized while the guides stayed where they were. One number, two consumers,
 * no way to move one without the other.
 */
export const DISCLOSURE_BOX_PX = 14;

/**
 * Where the first level's guide is painted.
 *
 * ⚠️ **Not the same as {@link INDENT_BASE_PX}, and it used to be.** The rule
 * is not "the same number twice" but "a guide is centred on the disclosure
 * column of the level it marks", which is what a reader perceives as aligned.
 * Sharing the row's base padding put every guide 7px to the LEFT of its own
 * chevron, at every depth.
 *
 * Derived rather than typed, because the correction is exactly half the
 * disclosure box: the eyeballed 14 and the computed 15 are both within a pixel
 * of right, and only one of them survives the chevron changing size.
 *
 * ⚠️ The gradient paints its hairline from this x, so the 1px line occupies
 * `[15, 16)` and its own centre is half a pixel right of the chevron's.
 * Deliberate: `14.5` would centre the line exactly and cost the hairline its
 * crispness on a 1x display, which is a worse trade for a 1px rule than half a
 * pixel of offset. Known, not overlooked.
 */
export const INDENT_GUIDE_ORIGIN_PX = INDENT_BASE_PX + DISCLOSURE_BOX_PX / 2;

/**
 * Whether a drag carries OS files rather than one of this tree's own rows.
 *
 * `dataTransfer.types` is the only readable signal during `dragover`:
 * `dataTransfer.files` is empty until `drop`, because the browser withholds
 * the bytes so a page cannot read a file merely by being dragged across it.
 * Checking the tree's drag id instead would be wrong in the other direction:
 * it is unset for an external drag, but also unset in the frame before an
 * internal drag's `dragstart` state lands.
 *
 * Exported because a consumer's own tests reach for it.
 */
export const isFileDrag = (e: DragEvent<HTMLElement>): boolean =>
  [...e.dataTransfer.types].includes("Files");

/**
 * Memoised, and the props above are shaped so that the DEFAULT shallow
 * comparison is enough: every one of them is a primitive, a node the tree
 * model memoises, or the facade that never changes identity.
 *
 * Before this discipline existed, one toggle re-rendered every visible row
 * along with its handlers: `rows` was already memoised, but each row received
 * the whole tree-state object, which is rebuilt on every render along with all
 * of its callbacks. Now a toggle re-renders only the rows whose own props
 * changed: the branch that opened, plus the rows that appeared or disappeared
 * beneath it.
 *
 * ⚠️ A prop added here must be shallow-comparable, or the memo silently stops
 * holding and nothing goes red. Anything that is not a primitive belongs on
 * the facade.
 */
export const TreeViewRow = memo(TreeViewRowImpl) as typeof TreeViewRowImpl;
