import { Input } from "@alepha/ui/components/ui/input";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { type KeyboardEvent, type ReactElement, useState } from "react";
import type { DirectoryController } from "@/api/controllers/DirectoryController.ts";
import type { I18n } from "../../../../services/I18n.ts";

/**
 * One entry of `directoryApi.searchFolio`'s response — directories, folios
 * and blobs in one flat list, matched by name (blobs/directories) or
 * `searchText` (folios — title, tags, summary and body).
 */
export interface FolioTreeSearchEntry {
  kind: "directory" | "folio" | "blob";
  id: string;
  shortId: number;
  name: string;
  pinned?: boolean;
  protected?: boolean;
}

export interface FolioTreeSearchProps {
  projectId: number;
  onResultsChange: (results: FolioTreeSearchEntry[] | null) => void;
  /**
   * Escape closes the whole search UI (not just the query) — the parent
   * owns whether the input is mounted at all.
   */
  onClose: () => void;
}

/**
 * The project-wide search bar rendered in place of the tree body while
 * active. Debounced 250ms via `useAction`'s built-in `debounce` option
 * rather than a hand-rolled timer. Distinct from Edit▸Find (Task 11), which
 * searches inside the one open folio; this searches every folio,
 * directory and blob in the project.
 *
 * Reports results through `onResultsChange` rather than rendering them
 * itself: `null` means "not searching, show the tree", `[]` means "searched,
 * nothing matched", and a non-empty array is the match list. The parent
 * (`FolioTree`) owns the distinction because it also decides what replaces
 * the tree body.
 */
const FolioTreeSearch = (props: FolioTreeSearchProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const directoryApi = useClient<DirectoryController>();
  const [query, setQuery] = useState("");

  const searchAction = useAction<[string], void>(
    {
      handler: async (q) => {
        const result = await directoryApi.searchFolio({
          params: { projectId: props.projectId },
          query: { q },
        });
        props.onResultsChange(result.entries as FolioTreeSearchEntry[]);
      },
      debounce: 250,
    },
    [props.projectId, directoryApi, props.onResultsChange],
  );

  const handleChange = (value: string): void => {
    setQuery(value);
    const trimmed = value.trim();
    if (!trimmed) {
      // Clearing restores the tree immediately — no need to wait out the
      // debounce for what is not a search at all.
      searchAction.cancel();
      props.onResultsChange(null);
      return;
    }
    searchAction.run(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") props.onClose();
  };

  return (
    <div className="flex h-9 flex-none items-center border-b border-border px-2">
      <Input
        autoFocus
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={String(tr("folios.editor.tree.search-placeholder"))}
        className="h-7 flex-1 text-xs"
      />
    </div>
  );
};

export default FolioTreeSearch;
