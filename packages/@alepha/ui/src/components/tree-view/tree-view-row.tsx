import { cn } from "@alepha/ui/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import type { TreeNode } from "./tree-model.ts";
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
}

/**
 * One row of a `TreeView`: the disclosure column (a chevron on a branch, a
 * spacer on a leaf), the icon slot, the label, and the trailing slot, over the
 * indent geometry.
 *
 * Drag and drop is #Q1940, inline rename and the context-menu slot are #Q1941.
 * Both arrive as opt-ins against the declaration in `tree-view.tsx`, and this
 * file stays the read-only core until then.
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

  return (
    // A tree row that is also a click target. The `tabIndex` and the
    // Enter/Space handler above are what keep the two a11y rules that would
    // otherwise fire here satisfied, rather than disabled.
    <div
      data-slot="tree-view-row"
      role="treeitem"
      // The rows are a flat list rather than nested `role="group"`
      // elements, so depth is spoken through `aria-level`, which is the
      // flat equivalent.
      aria-level={depth + 1}
      aria-expanded={node.branch ? !isCollapsed : undefined}
      aria-selected={isSelected || undefined}
      tabIndex={0}
      // Selection is otherwise only a background class, which is not
      // something a test (or a future stylesheet) can address.
      data-selected={isSelected || undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
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
      )}
      style={{
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
      }}
    >
      {isSelected && (
        // The accent bar. A selected row used to differ from its
        // neighbours by a background tint alone, which several themes
        // render almost invisibly.
        <span
          aria-hidden
          className="bg-primary pointer-events-none absolute inset-y-0 left-0 w-0.5"
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
      {/*
       * The label is its OWN element, separate from the row's click
       * handler and from the disclosure button, so a consumer that needs
       * an anchor here one day changes this line rather than the row.
       */}
      <span data-slot="tree-view-label" className="min-w-0 flex-1 truncate">
        {facade.renderLabel(node, state)}
      </span>
      {facade.renderTrailing(node, state)}
    </div>
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
