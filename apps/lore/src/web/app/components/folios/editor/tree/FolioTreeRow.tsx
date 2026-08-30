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
  type MouseEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import FolioTreeContextMenu from "./FolioTreeContextMenu.tsx";
import type { FolioDropPosition, FolioTreeNode } from "./folioTreeModel.ts";
import type { FolioTreeState } from "./useFolioTreeModel.ts";

export interface FolioTreeRowProps {
  node: FolioTreeNode;
  depth: number;
  tree: FolioTreeState;
  projectSlug: string;
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
  const tree = props.tree;
  const isDirectory = node.kind === "directory";
  const isCollapsed = tree.collapsed.has(node.id);
  const isSelected = tree.selectedId === node.id;
  const isRenaming = tree.renamingId === node.id;
  const isDragging = tree.dragId === node.id;
  const dropHere = tree.drop?.id === node.id ? tree.drop.position : undefined;
  // The directory a file drop on THIS row would land in: itself when it is a

  const [draftName, setDraftName] = useState(node.name);
  // Guards against a native `blur` fired by React unmounting the input on
  // Escape (removing a focused element from the DOM can still fire `blur`
  // in some browsers before the fiber is fully torn down) from being
  // mistaken for a user-initiated blur-to-commit.
  const cancelledRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Holds a directory row's deferred toggle so the double click can cancel
  // it. See `handleClick`.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(clickTimerRef.current), []);
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

  const handleClick = (e: MouseEvent): void => {
    if (isRenaming) return;
    // The second click of a double click must not repeat the first one's
    // action. `detail` is the browser's own click counter for the burst, so
    // this costs no timer and no latency.
    if (e.detail > 1) return;

    if (!isDirectory) {
      // A folio opens on the first click, immediately. Opening a folio is
      // the tree's most common action and must not pay the double-click
      // window; the row survives the navigation (same `$page`, different
      // param), so the rename input `onDoubleClick` opens is not unmounted
      // by it.
      tree.select(node);
      return;
    }

    // A directory's row-body toggle is the one action that has to wait.
    // `onDoubleClick` fires only AFTER both clicks, so toggling on the
    // first one would expand and collapse the disclosure on the way to the
    // rename. Deferring by the double-click window is what keeps that from
    // being visible.
    //
    // The chevron is deliberately NOT deferred: it stops propagation, so it
    // can never be the first half of a row double click, which leaves it as
    // the zero-latency way to open a directory.
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(
      () => tree.select(node),
      DOUBLE_CLICK_WINDOW_MS,
    );
  };

  const handleDoubleClick = (): void => {
    if (isRenaming) return;
    clearTimeout(clickTimerRef.current);
    tree.beginRename(node.id);
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
    if (!tree.dragId || tree.dragId === node.id) return;
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
            onDoubleClick={handleDoubleClick}
            className={cn(
              "hover:bg-muted/60 relative flex cursor-default items-center gap-1 py-1 pr-2 text-sm select-none",
              isSelected && "bg-muted font-medium",
              isDragging && "opacity-45",
              dropHere === "inside" &&
                "bg-primary/10 ring-primary/60 ring-1 ring-inset",
            )}
            style={{ paddingLeft: `${8 + props.depth * 13}px` }}
          />
        }
      >
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
            // `handleToggle` stops the click, but `dblclick` is a separate
            // event that would still reach the row and open a rename nobody
            // asked for on a fast double toggle.
            onDoubleClick={(e) => e.stopPropagation()}
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
            isDirectory ? "text-primary" : "text-muted-foreground",
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
            // Double clicking a word to select it is a normal thing to do in
            // a text input, and must not read as a rename request on the row
            // underneath.
            onDoubleClick={(e) => e.stopPropagation()}
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
        tree={tree}
        projectSlug={props.projectSlug}
      />
    </ContextMenu>
  );
};

/**
 * How long a directory row's toggle waits to see whether a second click is
 * coming. There is no way to read the platform's real double-click interval
 * from the web, so this is the conventional 250ms every file tree uses. Too
 * short and a slow double click expands the directory before renaming it;
 * too long and clicking a directory feels broken.
 *
 * Only directory ROWS pay it. See `handleClick`.
 */
const DOUBLE_CLICK_WINDOW_MS = 250;

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

export default FolioTreeRow;
