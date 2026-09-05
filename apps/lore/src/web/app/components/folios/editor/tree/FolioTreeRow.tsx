import {
  ContextMenu,
  ContextMenuTrigger,
} from "@alepha/ui/components/ui/context-menu";
import { cn } from "@alepha/ui/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Lock,
  Pin,
} from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import FolioTreeContextMenu from "./FolioTreeContextMenu.tsx";
import type { FolioDropPosition, FolioTreeNode } from "./folioTreeModel.ts";
import type { FolioTreeCommands } from "./useFolioTreeModel.ts";

export interface FolioTreeRowProps {
  node: FolioTreeNode;
  depth: number;
  /**
   * Stable for the life of the tree, which is what lets this component be
   * memoised at all. See `useFolioTreeModel`'s `commands`.
   */
  commands: FolioTreeCommands;
  projectSlug: string;
  /**
   * The four state flags and the drop marker are passed as PRIMITIVES
   * rather than derived from the tree state here. That is the whole reason
   * the memo below holds: a toggle changes `rows` and `collapsed`, so any
   * prop carrying the state object would change identity on every row.
   */
  isCollapsed: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  isDragging: boolean;
  /**
   * Whether ANY row of this tree is being dragged, which is not the same
   * question as `isDragging`. `handleDragOver` needs it to tell an internal
   * drag from an external one that carries no files.
   */
  isDragActive: boolean;
  dropHere?: FolioDropPosition;
}

/**
 * One row of the folio tree: chevron (directories only), kind icon,
 * label/inline-rename input, pinned badge, native HTML5 drag & drop, and a
 * right-click menu.
 *
 * Drop zones: a directory splits 28% / 44% / 28% (before / inside / after);
 * a folio splits 50/50 with no inside area (it can't hold children).
 * `@dnd-kit` is the house drag library elsewhere in this app (kanban,
 * `FolioBrowser`), but three drop zones per row is ~40 lines of
 * `onDragOver` arithmetic natively versus writing custom collision
 * detection for a library built around a single drop target per area —
 * native DnD stays local to this one component.
 */
const FolioTreeRow = (props: FolioTreeRowProps): ReactElement => {
  const node = props.node;
  const tree = props.commands;
  const isDirectory = node.kind === "directory";
  const { isCollapsed, isSelected, isRenaming, isDragging, dropHere } = props;

  const [draftName, setDraftName] = useState(node.name);
  // Guards against a native `blur` fired by React unmounting the input on
  // Escape (removing a focused element from the DOM can still fire `blur`
  // in some browsers before the fiber is fully torn down) from being
  // mistaken for a user-initiated blur-to-commit.
  const cancelledRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // React-documented "adjust state during render" pattern: reset the draft
  // to the CURRENT name exactly on the OFF→ON transition into rename mode,
  // not just at this row's mount. `useState(node.name)`'s initializer only
  // runs once — without this, renaming the same row a second time (after
  // the first rename already changed `node.name`) would reopen showing the
  // pre-first-rename name.
  const wasRenamingRef = useRef(false);
  if (isRenaming && !wasRenamingRef.current) {
    setDraftName(node.name);
  }
  wasRenamingRef.current = isRenaming;

  // Focus the input when it appears (the a11y rule that removed `autoFocus`
  // left rename, new folio and new directory opening an input nobody could
  // type into without clicking it first).
  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  /**
   * One gesture, one meaning: a click opens the row it is on.
   *
   * ⚠️ There is no double-click handler any more, and the machinery that
   * disambiguated one gesture from the other went with it (feedback #2101).
   * Renaming is the context menu's job, which is where it already was.
   *
   * The history is worth keeping, because it is a story about a defer that
   * was never paying for anything real. A directory used to wait 250ms for
   * a possible second click, since `dblclick` fires only after both and
   * toggling on the first one would expand the disclosure on the way to a
   * rename. That timer was the whole of the "opening a directory takes too
   * many ms" report (feedback #2089): expanding fetches nothing, the tree
   * is built from two atoms already in the store, so the latency was the
   * timer and not a cost, and the chevron beside it was already instant.
   *
   * Quest #1800 replaced that defer with an optimistic toggle plus a
   * REVERT on the double click, which traded the delay for about a frame of
   * flicker. Dropping the gesture removes both: there is nothing to revert,
   * so there is nothing to flicker.
   *
   * ⚠️ The `e.detail` guard STAYS, though the quest that removed the rest
   * listed it for deletion "if nothing else needs them". Something does. A
   * real double click fires click, click, then dblclick, so without it the
   * two clicks toggle a directory twice and it ends collapsed - a different
   * outcome from the single click that shares its first half, reached by
   * doing the same thing faster. It costs no timer and no latency: `detail`
   * is the browser's own counter for the burst, already on the event.
   */
  const handleClick = (e: MouseEvent): void => {
    if (isRenaming) return;
    if (e.detail > 1) return;
    tree.select(node);
  };

  const handleToggle = (e: MouseEvent): void => {
    e.stopPropagation();
    tree.toggle(node.id);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
    tree.onDragStart(node.id);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    if (isFileDrag(e)) {
      // An OS file drag has nowhere to land in the tree any more —
      // attachments belong to a folio, not to a folder — so refuse it
      // rather than silently treating it as a row re-parent.
      e.dataTransfer.dropEffect = "none";
      return;
    }
    if (!props.isDragActive || isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const position: FolioDropPosition = isDirectory
      ? y < rect.height * 0.28
        ? "before"
        : y > rect.height * 0.72
          ? "after"
          : "inside"
      : y < rect.height / 2
        ? "before"
        : "after";
    tree.onDragOver(node.id, position);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    if (isFileDrag(e)) return;
    void tree.onDrop(node.id);
  };

  const handleDragEnd = (): void => {
    tree.onDragEnd();
  };

  const commit = (): void => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    void tree.commitRename(node.id, draftName);
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      cancelledRef.current = true;
      tree.cancelRename();
    }
  };

  const Icon = isDirectory
    ? isCollapsed
      ? Folder
      : FolderOpen
    : node.kind === "protected"
      ? Lock
      : FileText;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          // A drag-and-drop tree row rendered through ContextMenuTrigger. It carries
          // `tabIndex` and an Enter/Space handler of its own further down.
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
          <div
            data-slot="folio-tree-row"
            // Selection is otherwise only a background class, which is not
            // something a test (or a future stylesheet) can address.
            data-selected={isSelected || undefined}
            draggable={!isRenaming}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
            className={cn(
              "hover:bg-muted/60 relative flex cursor-default items-center gap-1 py-1 pr-2 text-sm select-none",
              // ⚠️ Named properties, never `transition-all`. This element is
              // an HTML5 drag SOURCE that already animates `opacity` while
              // dragging and carries the ring and line drop markers; a
              // blanket transition puts all three on a timer, so the drop
              // indicator lags the pointer it is supposed to track.
              "transition-[background-color,transform] duration-150",
              // The press. Suppressed while dragging, because a transform on
              // a drag source moves the browser's own drag image with it.
              !isDragging && !isRenaming && "active:translate-y-px",
              isSelected && "bg-muted font-medium",
              isDragging && "opacity-45",
              dropHere === "inside" &&
                "bg-primary/10 ring-primary/60 ring-1 ring-inset",
            )}
            style={{
              paddingLeft: `${INDENT_BASE_PX + props.depth * INDENT_STEP_PX}px`,
              // Indent guides, as pure CSS: one hairline per ancestor level,
              // painted as a repeating gradient clipped to the indent area so
              // it can never run under the label. A background IMAGE, so the
              // row's background COLOUR (hover, selection) still shows
              // through underneath.
              ...(props.depth > 0 && {
                backgroundImage:
                  "repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px " +
                  `${INDENT_STEP_PX}px)`,
                backgroundPosition: `${INDENT_BASE_PX}px 0`,
                backgroundSize: `${props.depth * INDENT_STEP_PX}px 100%`,
                backgroundRepeat: "no-repeat",
              }),
            }}
          />
        }
      >
        {isSelected && (
          // The accent bar. A selected row used to differ from its
          // neighbours by a background tint alone, which several of the six
          // themes render almost invisibly.
          <span
            aria-hidden
            className="bg-primary pointer-events-none absolute inset-y-0 left-0 w-0.5"
          />
        )}
        {dropHere === "before" && (
          <div className="bg-primary pointer-events-none absolute inset-x-0 top-0 h-0.5" />
        )}
        {dropHere === "after" && (
          <div className="bg-primary pointer-events-none absolute inset-x-0 bottom-0 h-0.5" />
        )}
        {isDirectory ? (
          <button
            type="button"
            onClick={handleToggle}
            className="flex size-3.5 shrink-0 items-center justify-center"
          >
            {isCollapsed ? (
              <ChevronRight className="size-3 opacity-60" />
            ) : (
              <ChevronDown className="size-3 opacity-60" />
            )}
          </button>
        ) : (
          <span className="inline-block w-3.5 shrink-0" />
        )}
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            // ⚠️ Theme tokens, not hardcoded hexes. The reference this was
            // taken from (`apps/docs`'s file tree) is a single dark theme
            // and spells its amber and cyan literally; Lore has six themes,
            // and a literal pair is wrong in five of them. `--chart-*` was
            // considered and rejected for the same reason: it is defined in
            // `@alepha/ui`'s base `:root` / `.dark` only, so it is
            // light/dark aware but NOT theme aware. These two are defined
            // once per theme in `main.css`.
            isDirectory
              ? "text-[var(--folio-tree-directory)]"
              : "text-[var(--folio-tree-folio)]",
          )}
        />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            className="border-primary bg-background min-w-0 flex-1 rounded border px-1 text-sm outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}
        {!isRenaming && node.pinned && (
          <Pin className="text-primary size-3 shrink-0" />
        )}
      </ContextMenuTrigger>
      <FolioTreeContextMenu
        node={node}
        commands={tree}
        projectSlug={props.projectSlug}
      />
    </ContextMenu>
  );
};

/**
 * How far one level of nesting indents a row, in pixels.
 *
 * Shared by the row's own left padding and by the indent guides drawn
 * behind it, so the two cannot drift: a guide that does not line up with
 * the icon it belongs to is worse than no guide.
 */
const INDENT_STEP_PX = 13;

/**
 * Where the first level's guide sits, which is also the row's own base
 * padding.
 */
const INDENT_BASE_PX = 8;

/**
 * Whether a drag carries OS files rather than one of this tree's own rows.
 *
 * `dataTransfer.types` is the only readable signal during `dragover` —
 * `dataTransfer.files` is empty until `drop` (the browser withholds the bytes
 * so a page cannot read a file merely by being dragged across). Checking
 * `tree.dragId` instead would be wrong in the other direction: it is unset
 * for an external drag, but also unset in the frame before an internal drag's
 * `dragstart` state lands.
 */
const isFileDrag = (e: DragEvent<HTMLElement>): boolean =>
  [...e.dataTransfer.types].includes("Files");

export { isFileDrag };

/**
 * Memoised, and the props above are shaped so that the DEFAULT shallow
 * comparison is enough: every one of them is a primitive, a node the tree
 * model memoises, or the command facade that never changes identity.
 *
 * Before this, one toggle re-rendered every visible row along with its drag
 * handlers and its context menu: `rows` was already memoised, but each row
 * received the whole tree-state object, which is rebuilt on every render
 * along with all fourteen of its callbacks. Now a toggle re-renders only
 * the rows whose own props changed - the directory that opened, plus the
 * rows that appeared or disappeared beneath it.
 *
 * ⚠️ A prop added here must be shallow-comparable, or the memo silently
 * stops holding and nothing goes red.
 */
export default memo(FolioTreeRow);
