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
  Paperclip,
  Pin,
} from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
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
  projectIdStr: string;
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
  // directory, otherwise its parent — dropping a file next to a folio puts it
  // beside that folio rather than dead-zoning half the tree.
  const fileDropParentId = isDirectory ? node.id : node.parentId;
  const isFileDropTarget =
    isDirectory && tree.fileDrop?.parentId === fileDropParentId;

  const [draftName, setDraftName] = useState(node.name);
  // Guards against a native `blur` fired by React unmounting the input on
  // Escape (removing a focused element from the DOM can still fire `blur`
  // in some browsers before the fiber is fully torn down) from being
  // mistaken for a user-initiated blur-to-commit.
  const cancelledRef = useRef(false);
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

  const handleClick = (): void => {
    if (isRenaming) return;
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
      // `dataTransfer.files` is deliberately empty during `dragover` (the
      // browser only exposes the bytes on `drop`), so `types` is the only
      // thing that can tell an OS file drag from a row being re-parented.
      e.dataTransfer.dropEffect = "copy";
      tree.onFileDragOver(fileDropParentId);
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
    if (isFileDrag(e)) {
      void tree.dropFiles([...e.dataTransfer.files], fileDropParentId);
      return;
    }
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
      : node.kind === "blob"
        ? Paperclip
        : FileText;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            data-slot="folio-tree-row"
            draggable={!isRenaming}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
            className={cn(
              "relative flex cursor-default items-center gap-1 py-1 pr-2 text-sm select-none hover:bg-muted/60",
              isSelected && "bg-muted font-medium",
              isDragging && "opacity-45",
              (dropHere === "inside" || isFileDropTarget) &&
                "bg-primary/10 ring-1 ring-inset ring-primary/60",
            )}
            style={{ paddingLeft: `${8 + props.depth * 13}px` }}
          />
        }
      >
        {dropHere === "before" && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />
        )}
        {dropHere === "after" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
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
            isDirectory ? "text-primary" : "text-muted-foreground",
          )}
        />
        {isRenaming ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-primary bg-background px-1 text-sm outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}
        {!isRenaming && node.pinned && (
          <Pin className="size-3 shrink-0 text-primary" />
        )}
      </ContextMenuTrigger>
      <FolioTreeContextMenu
        node={node}
        tree={tree}
        projectIdStr={props.projectIdStr}
      />
    </ContextMenu>
  );
};

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
