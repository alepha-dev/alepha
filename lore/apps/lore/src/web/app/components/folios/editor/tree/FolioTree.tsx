import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { FilePlus, FolderPlus, Search, X } from "lucide-react";
import { type ReactElement, useState } from "react";
import type { I18n } from "../../../../services/I18n.ts";
import FolioTreeRow from "./FolioTreeRow.tsx";
import FolioTreeSearch, {
  type FolioTreeSearchEntry,
} from "./FolioTreeSearch.tsx";
import FolioTreeSearchRow from "./FolioTreeSearchRow.tsx";
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
}

/**
 * The folio tree pane: directories + folios, native HTML5 drag & drop, a
 * right-click menu (`FolioTreeContextMenu`, via `FolioTreeRow`), inline
 * rename, and project-wide search. 242px fixed width, a 40px header row
 * (title + New folio / New directory / Search), scrolling body.
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<
    FolioTreeSearchEntry[] | null
  >(null);

  const closeSearch = (): void => {
    setSearchOpen(false);
    setSearchResults(null);
  };

  return (
    <div className="flex h-full min-h-0 w-[242px] flex-none flex-col overflow-hidden border-r border-border">
      <div className="flex h-10 flex-none items-center gap-1 border-b border-border px-2">
        <span className="flex-1 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
          aria-pressed={searchOpen}
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          aria-label={String(tr("folios.editor.tree.search"))}
        >
          {searchOpen ? (
            <X className="size-3.5" />
          ) : (
            <Search className="size-3.5" />
          )}
        </Button>
      </div>

      {searchOpen && (
        <FolioTreeSearch
          projectId={props.projectId}
          onResultsChange={setSearchResults}
          onClose={closeSearch}
        />
      )}

      {/*
        Body state is keyed on `searchResults`, NOT `searchOpen`: the search
        bar can stay open (so the user can keep typing) while the query is
        blank, and a blank query means "not searching" — "Clearing restores
        the tree" per the spec, without also forcing the user to close the
        search bar to see it. `searchResults` is `null` exactly when there
        is no active query.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {searchResults !== null && searchResults.length === 0 && (
          <p className="px-3 py-4 text-center text-xs italic text-muted-foreground">
            {tr("folios.editor.tree.search-empty")}
          </p>
        )}
        {searchResults?.map((entry) => (
          <FolioTreeSearchRow
            key={`${entry.kind}:${entry.id}`}
            entry={entry}
            projectIdStr={props.projectIdStr}
          />
        ))}
        {searchResults === null && !tree.loading && tree.rows.length === 0 && (
          <p className="px-3 py-4 text-center text-xs italic text-muted-foreground">
            {tr("folios.editor.tree.empty")}
          </p>
        )}
        {searchResults === null &&
          tree.rows.map((row) => (
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
