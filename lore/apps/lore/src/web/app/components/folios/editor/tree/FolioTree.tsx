import { Button } from "@alepha/ui/components/ui/button";
import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { FilePlus, FolderPlus, Upload } from "lucide-react";
import { type DragEvent, type ReactElement, useEffect, useRef } from "react";
import type { I18n } from "../../../../services/I18n.ts";
import FolioTreeRow, { isFileDrag } from "./FolioTreeRow.tsx";
import { useFolioTreeModel } from "./useFolioTreeModel.ts";

export interface FolioTreeProps {
  projectId: number;
  projectIdStr: string;
  /**
   * The folio open in the document pane, if any — drives the highlighted
   * row and which ancestor directories auto-expand. `undefined` on the
   * create-mode `/folios/new` page.
   */
  currentFolioId?: string;
  /**
   * Pane width in pixels. Owned by `useFolioPanes` so the drag handle's
   * value persists and survives a folio-to-folio navigation, like every
   * other pane preference.
   */
  width: number;
  /**
   * Hands the tree's two creation actions up to the workspace, so the
   * menubar can drive them on the empty `/folios` state where there is no
   * `useFolioActions` to route them through.
   *
   * A callback rather than hoisting `useFolioTreeModel` into the workspace:
   * the model owns local state the tree needs (`renamingId` — a freshly
   * created directory opens straight into inline rename), so a second
   * instance would create the row and then fail to focus it. Mirrors how
   * `FolioEditorMenubar` hands its realm dispatchers up.
   */
  onActions?: (actions: FolioTreeActions) => void;
}

export interface FolioTreeActions {
  createFolio: () => void;
  createDirectory: () => void;
}

/**
 * The folio tree pane: directories + folios, native HTML5 drag & drop, a
 * right-click menu (`FolioTreeContextMenu`, via `FolioTreeRow`) and inline
 * rename. Resizable width (see `width`), a 40px header row (title + New
 * folio / New directory), scrolling body.
 *
 * It no longer carries a search of its own. Searching only folios, only
 * inside this pane, was the narrower half of a job the ⌘K palette now does
 * across quests and folios at once from anywhere in the app — two search
 * boxes for overlapping sets is a choice the reader should not have to
 * make. See `shared/spotlight/Spotlight.tsx`.
 *
 * Mounted from `FolioWorkspace.tsx`, NOT from the folio-keyed
 * `FolioWorkspaceContent` — see `useFolioTreeModel`'s file doc for why that
 * placement is load-bearing, not a style choice.
 */
const FolioTree = (props: FolioTreeProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const tree = useFolioTreeModel({
    projectId: props.projectId,
    projectIdStr: props.projectIdStr,
    currentFolioId: props.currentFolioId,
  });

  // Published through a ref, and the published closures read through it too.
  // `useFolioTreeModel` returns fresh function identities every render, so
  // depending on them here meant: effect re-runs → parent setState → parent
  // re-renders this → new identities → effect re-runs. That was a live
  // "Maximum update depth exceeded" loop. The ref keeps the published object
  // stable (created once per `onActions` identity) while the closures still
  // reach the current model.
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const { onActions } = props;
  useEffect(() => {
    onActions?.({
      createFolio: () => void treeRef.current.createFolio(),
      createDirectory: () => void treeRef.current.createDirectory(),
    });
  }, [onActions]);

  const handleRootDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    tree.onFileDragOver(undefined);
  };

  /**
   * An external file drag has no `dragend` here — that event fires on the
   * source element, which lives in another application. So the highlight has
   * to be cleared on the way out, and `dragleave` fires on every child
   * boundary crossed: the `contains` check keeps a row-to-row move from
   * flickering the whole pane off and on.
   */
  const handleRootDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    tree.onFileDragLeave();
  };

  const handleRootDrop = (e: DragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    void tree.dropFiles([...e.dataTransfer.files], undefined);
  };

  return (
    <div
      data-slot="folio-tree"
      style={{ width: props.width }}
      className="border-border flex h-full min-h-0 flex-none flex-col overflow-hidden border-r"
    >
      <div className="border-border flex h-10 flex-none items-center gap-1 border-b px-2">
        <span className="text-muted-foreground flex-1 truncate text-xs font-medium tracking-wide uppercase">
          {tr("folios.editor.tree.title")}
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => tree.createFolio()}
          aria-label={String(tr("folios.editor.tree.new-folio"))}
        >
          <FilePlus className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => tree.createDirectory()}
          aria-label={String(tr("folios.editor.tree.new-directory"))}
        >
          <FolderPlus className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => tree.uploadBlobs()}
          aria-label={String(tr("folios.editor.tree.upload"))}
        >
          <Upload className="size-3.5" />
        </Button>
      </div>

      {/* The scroll body doubles as the project-root drop target: a file
          dropped on empty space below the last row lands at the root, and a
          row's own handler stops propagation before this one sees it. */}
      <div
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto py-1",
          tree.fileDrop &&
            tree.fileDrop.parentId === undefined &&
            "bg-primary/5 ring-1 ring-inset ring-primary/40",
        )}
      >
        {!tree.loading && tree.rows.length === 0 && (
          <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
            {tr("folios.editor.tree.empty")}
          </p>
        )}
        {tree.rows.map((row) => (
          <FolioTreeRow
            key={row.node.id}
            node={row.node}
            depth={row.depth}
            tree={tree}
            projectIdStr={props.projectIdStr}
          />
        ))}
      </div>
    </div>
  );
};

export default FolioTree;
