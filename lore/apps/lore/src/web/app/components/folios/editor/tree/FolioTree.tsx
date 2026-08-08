import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { FilePlus, FolderPlus } from "lucide-react";
import type { ReactElement } from "react";
import type { I18n } from "../../../../services/I18n.ts";
import FolioTreeRow from "./FolioTreeRow.tsx";
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
