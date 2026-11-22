import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@alepha/ui";
import { TREE_ROOT_ID, TreeView } from "@alepha/ui/tree";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import {
  FilePlus,
  FileText,
  FileUp,
  Table2,
  CalendarDays,
  FolderPlus,
  Lock,
  PanelLeftClose,
  Pin,
  RefreshCw,
} from "lucide-react";
import { lazy, type ReactElement, Suspense, useEffect, useState } from "react";

import FolioPassphraseDialog from "../../FolioPassphraseDialog.tsx";
import { asFolioNode, type FolioTreeData } from "./folioTree.ts";
import FolioTreeContextMenu from "./FolioTreeContextMenu.tsx";
import FolioTreeDirectoryIcon from "./FolioTreeDirectoryIcon.tsx";
import FolioTreeRootContextMenu from "./FolioTreeRootContextMenu.tsx";

/**
 * The CSV import dialog (#Q3517), a lazy chunk: the tree loads it only
 * once someone imports.
 */
const FolioCsvImportDialog = lazy(
  () => import("../table/FolioCsvImportDialog.tsx"),
);
import { useFolioTreeModel } from "./useFolioTreeModel.ts";

export interface FolioTreeProps {
  projectId: number;
  projectSlug: string;
  /**
   * Puts the pane away from its own header, the way the inspector's own
   * header closes it (feedback #P2136). `useFolioPanes.toggleTree`, passed
   * down rather than reached for, because the state lives above both panes.
   */
  onCollapse: () => void;
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
   * instance would create the row and then fail to focus it.
   */
  onActions?: (actions: FolioTreeActions) => void;
  /**
   * `/folios?dir=<shortId>` - open the tree at that directory. Threaded
   * from `FolioWorkspaceShell`, which reads it off the URL; see
   * `UseFolioTreeModelInput.revealDirectoryShortId`.
   */
  revealDirectoryShortId?: number;
}

export interface FolioTreeActions {
  /**
   * `parentId` is the directory to create in; absent creates at the root.
   * The empty workspace's directory listing passes the one it lists.
   */
  createFolio: (parentId?: string) => void;
  createDirectory: (parentId?: string) => void;
}

/**
 * The folio tree pane: directories + folios, native HTML5 drag & drop, a
 * right-click menu (`FolioTreeContextMenu`) and inline rename. Resizable
 * width (see `width`), a 44px header row (`h-11`, the height of the document
 * and inspector bars beside it) holding the pane's actions, scrolling body.
 *
 * The rows, the indent geometry, the drag zones, the rename input and the
 * memo all live in `@alepha/ui`'s `TreeView` now. What is Lore's is
 * everything this file passes it: the directory emblems, the pin badge, the
 * context menu's verbs, and the model behind them.
 *
 * It no longer carries a search of its own. Searching only folios, only
 * inside this pane, was the narrower half of a job the ⌘K palette now does
 * across quests and folios at once from anywhere in the app — two search
 * boxes for overlapping sets is a choice the reader should not have to
 * make. See `shared/spotlight/Spotlight.tsx`.
 *
 * Mounted from `FolioWorkspaceShell.tsx`, in the `/folios` layout, NOT from
 * the page that remounts per folio: see `useFolioTreeModel`'s file doc for why that
 * placement is load-bearing, not a style choice.
 */
const FolioTree = (props: FolioTreeProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const tree = useFolioTreeModel({
    projectId: props.projectId,
    projectSlug: props.projectSlug,
    currentFolioId: props.currentFolioId,
    revealDirectoryShortId: props.revealDirectoryShortId,
  });

  // `tree.commands` is stable for the life of the hook, so this effect can
  // depend on it honestly. It used to need a ref: the model returned fresh
  // function identities every render, so depending on them meant effect
  // re-runs, parent setState, a re-render here, new identities, and a live
  // "Maximum update depth exceeded" loop. The stable facade that makes the
  // shared row's memo hold removed the need for the workaround too.
  const { onActions } = props;
  const { commands, canWrite } = tree;

  // The root as a drop target, the way the tree judges any folder: a drag
  // over the empty space, or over a root-level folio, lands in the root, and
  // that means something only when the dragged item is not there already.
  const dragged = tree.dragId
    ? tree.rows.find((row) => row.node.id === tree.dragId)?.node
    : undefined;
  const rootAllowed =
    !!dragged && (dragged.declaredParentId ?? dragged.parentId) !== undefined;
  const dropOver = tree.drop
    ? tree.rows.find((row) => row.node.id === tree.drop?.id)?.node
    : undefined;
  const rootTargeted =
    rootAllowed &&
    (tree.drop?.id === TREE_ROOT_ID ||
      (!!dropOver && !dropOver.branch && dropOver.parentId === undefined));

  // A CSV import (#Q3517): from the New menu, or a `.csv` dropped on the
  // tree (a directory row imports into it, a folio row into its directory,
  // the empty pane into the root).
  const [importing, setImporting] = useState<
    { directoryId?: string; file?: File } | undefined
  >(undefined);
  const csvOf = (files: File[]) =>
    files.find((file) => /\.csv$/i.test(file.name) || file.type === "text/csv");
  const dropFiles = (id: string | undefined, files: File[]) => {
    const file = csvOf(files);
    if (!file || !canWrite) return;
    const node = id
      ? tree.rows.find((row) => row.node.id === id)?.node
      : undefined;
    const directoryId =
      node === undefined
        ? undefined
        : node.data.kind === "directory"
          ? node.id
          : node.parentId;
    setImporting({ directoryId, file });
  };
  useEffect(() => {
    onActions?.({
      createFolio: (parentId) => void commands.createFolio(parentId),
      createDirectory: (parentId) => void commands.createDirectory(parentId),
    });
  }, [onActions, commands]);

  return (
    <div
      data-slot="folio-tree"
      style={{ width: props.width }}
      className="flex h-full min-h-0 flex-none flex-col overflow-hidden"
      onDragOver={(event) => {
        if (canWrite && [...event.dataTransfer.types].includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        dropFiles(undefined, [...event.dataTransfer.files]);
      }}
    >
      {/* No visible title (#Q3656): the pane is the folio tree wherever it
          opens, so the strip holds only its actions: collapse at the left,
          the rest at the right (#Q3693). The tree
          keeps its accessible name, `TreeView`'s `label` below. */}
      <div className="border-border flex h-11 flex-none items-center gap-1 border-b px-2">
        {/* First in the row (#Q3693), the pane control at the pane's outer
            edge, the inspector's mirror; the tree's actions sit at the
            other end. Outside `canWrite`: a Viewer reads the tree and is
            just as entitled to put it away. */}
        <Button
          type="button"
          size="icon-sm"
          variant="minimal"
          onClick={props.onCollapse}
          aria-label={tr("folios.editor.tree.collapse")}
          title={tr("folios.editor.tree.collapse")}
        >
          <PanelLeftClose className="size-3.5" />
        </Button>
        <div className="flex-1" />
        {/* Both doors to a write, and the same permission behind them - the
            one `FolioTreeContextMenu` already asks for its own items. The
            tree itself stays: reading the project's folios is a Viewer's
            whole point. */}
        {/* ⚠️ `title` AS WELL AS `aria-label`, from the same key so the two
            cannot drift. An `aria-label` names the button for a screen
            reader and for nobody else: a pointer user saw two unlabelled
            14px glyphs, and file-plus against folder-plus is exactly the
            pair worth telling apart before clicking, since one of them
            makes a directory (feedback #P2135).

            Same reasoning `MarkdownModeToggle` writes down for its own
            icon-only variant. Not a `Tooltip`, because these sit in a 40px
            header strip where the native one costs nothing and a portalled
            popup would need a provider this pane does not have. */}
        {/* First, and outside `canWrite`: a Viewer reads the tree, and a
            folio an agent filed over MCP is as invisible to them until it
            reloads (#Q2935). */}
        <Button
          type="button"
          size="icon-sm"
          variant="minimal"
          onClick={() => commands.refresh()}
          disabled={tree.refreshing}
          aria-label={tr("folios.editor.tree.refresh")}
          title={tr("folios.editor.tree.refresh")}
        >
          <RefreshCw className="size-3.5" />
        </Button>
        {canWrite && (
          <>
            {/* New folio offers a doc, a table and a calendar (#E144,
                #Q3717). */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="minimal"
                    aria-label={tr("folios.editor.tree.new-folio")}
                    title={tr("folios.editor.tree.new-folio")}
                  />
                }
              >
                <FilePlus className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => commands.createFolio()}>
                  <FileText className="size-4" />
                  {tr("folios.editor.tree.new-text")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => commands.createTable()}>
                  <Table2 className="size-4" />
                  {tr("folios.editor.tree.new-table")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => commands.createCalendar()}>
                  <CalendarDays className="size-4" />
                  {tr("folios.editor.tree.new-calendar")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImporting({})}>
                  <FileUp className="size-4" />
                  {tr("folios.editor.tree.import-csv")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              size="icon-sm"
              variant="minimal"
              onClick={() => commands.createDirectory()}
              aria-label={tr("folios.editor.tree.new-directory")}
              title={tr("folios.editor.tree.new-directory")}
            >
              <FolderPlus className="size-3.5" />
            </Button>
          </>
        )}
      </div>

      {/* `flex flex-col` for the filler below, which takes the space the
          rows leave and is the right-click target for the root. Rows are
          unaffected: a flex item's `min-height` is `auto`, so the tree
          keeps its content height and the container still scrolls. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto py-1 transition-colors",
          // The root folder is the drop's target: the whole pane lights up,
          // as a file manager lights the folder a file goes in.
          rootTargeted && "bg-primary/15",
        )}
        // A drag released over the empty space, or between the rows'
        // padding, goes to the root. A row handles its own drop and stops it.
        onDragOver={(event) => {
          if (!tree.dragId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = rootAllowed ? "move" : "none";
          commands.onDragOver(TREE_ROOT_ID, "inside");
        }}
        onDrop={(event) => {
          if (!tree.dragId) return;
          event.preventDefault();
          void commands.onDrop(TREE_ROOT_ID);
        }}
      >
        {!tree.loading && tree.rows.length === 0 && (
          <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
            {tr("folios.editor.tree.empty")}
          </p>
        )}
        <TreeView<FolioTreeData>
          label={tr("folios.editor.tree.title")}
          rows={tree.rows}
          collapsed={tree.collapsed}
          selectedId={tree.selectedId}
          selectedIds={tree.selectedIds}
          onSelect={(node, options) =>
            commands.select(asFolioNode(node), options)
          }
          onToggle={commands.toggle}
          renderIcon={(node, state) => {
            const folio = asFolioNode(node);
            if (folio.data.kind === "directory") {
              return (
                <FolioTreeDirectoryIcon
                  name={folio.name}
                  isCollapsed={state.collapsed}
                />
              );
            }
            // ⚠️ Theme tokens, not hardcoded hexes. Lore has six themes and
            // a literal pair is wrong in five of them; `--chart-*` was
            // considered and rejected, since it is defined in `@alepha/ui`'s
            // base `:root` / `.dark` only, so it is light/dark aware but NOT
            // theme aware. These are defined once per theme in `main.css` -
            // the directory half lives in `FolioTreeDirectoryIcon`.
            const Icon =
              folio.data.kind === "protected"
                ? Lock
                : folio.data.calendar
                  ? CalendarDays
                  : folio.data.table
                    ? Table2
                    : FileText;
            return (
              <Icon className="size-3.5 shrink-0 text-[var(--folio-tree-folio)]" />
            );
          }}
          renderTrailing={(node) => {
            const folio = asFolioNode(node);
            return folio.data.pinned ? (
              <Pin className="text-primary size-3 shrink-0" />
            ) : null;
          }}
          renderMenu={(node) => (
            <FolioTreeContextMenu
              node={asFolioNode(node)}
              commands={commands}
              projectSlug={props.projectSlug}
              currentFolioId={props.currentFolioId}
            />
          )}
          // Dragging a row IS a move, so a reader who may not write does not
          // get to start one.
          draggable={canWrite}
          dragId={tree.dragId}
          drop={tree.drop}
          onDragStart={commands.onDragStart}
          onDragOver={commands.onDragOver}
          onDrop={commands.onDrop}
          onFilesDrop={canWrite ? dropFiles : undefined}
          onDragEnd={commands.onDragEnd}
          renamingId={tree.renamingId}
          onCommitRename={commands.commitRename}
          onCancelRename={commands.cancelRename}
        />
        {/* The empty space below the last row, and its own menu (feedback
            #P2134). A SIBLING of the tree rather than a wrapper around it,
            so a right-click on a row still gets the row's own menu - see
            this component's doc. Behind the same `canWrite` as the header's
            create buttons. */}
        {canWrite && <FolioTreeRootContextMenu commands={commands} />}
      </div>

      {/* The tree's own passphrase dialog, and the SAME component the editor
          uses (#Q2114). `requireConfirm` and the encrypt strings come with
          it, including the warning that there is no recovery - which is the
          one thing this flow must not restate in its own words. */}
      {importing && (
        <Suspense fallback={null}>
          <FolioCsvImportDialog
            open
            onOpenChange={(open) => {
              if (!open) setImporting(undefined);
            }}
            target={{ kind: "new", directoryId: importing.directoryId }}
            file={importing.file}
          />
        </Suspense>
      )}

      <FolioPassphraseDialog
        open={tree.encryptingTitle !== undefined}
        onOpenChange={(open) => {
          if (!open) commands.cancelEncrypt();
        }}
        title={tr("folios.protected.encrypt-title")}
        description={tr("folios.protected.encrypt-description")}
        submitLabel={tr("folios.protected.encrypt")}
        requireConfirm
        onSubmit={commands.confirmEncrypt}
      />
    </div>
  );
};

export default FolioTree;
