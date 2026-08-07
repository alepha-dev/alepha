import { useRouter } from "alepha/react/router";
import { File, FileText, Folder, Lock, Pin } from "lucide-react";
import type { ReactElement } from "react";
import type { AppRouter } from "../../../../AppRouter.ts";
import type { FolioTreeSearchEntry } from "./FolioTreeSearch.tsx";

export interface FolioTreeSearchRowProps {
  entry: FolioTreeSearchEntry;
  projectIdStr: string;
}

/**
 * One row of a project-wide search result. Not part of the brief's file
 * list — extracted from `FolioTree.tsx` to satisfy this repo's "one
 * component per file" rule (`apps/lore/CLAUDE.md` / global React
 * conventions) rather than inlining a second component into that file.
 *
 * A directory result navigates to the folio browser filtered to it
 * (`?dir=<shortId>`) — search results aren't part of the live tree
 * structure, so there is no row to expand in place. A blob result has no
 * dedicated page at all (`searchFolio`'s blob entries don't even carry
 * their parent directory), so it opens the same direct-download link
 * `FolioBrowser.handleDownload` uses for a blob row.
 */
const FolioTreeSearchRow = (props: FolioTreeSearchRowProps): ReactElement => {
  const router = useRouter<AppRouter>();
  const entry = props.entry;
  const Icon =
    entry.kind === "directory"
      ? Folder
      : entry.kind === "blob"
        ? File
        : entry.protected
          ? Lock
          : FileText;

  const handleClick = (): void => {
    if (entry.kind === "directory") {
      router.push(
        `${router.path("projectFolios", { params: { projectId: props.projectIdStr } })}?dir=${entry.shortId}`,
      );
      return;
    }
    if (entry.kind === "folio") {
      router.push(
        router.path("projectFoliosFolio", {
          params: { projectId: props.projectIdStr, shortId: entry.shortId },
        }),
      );
      return;
    }
    window.open(`/api/files/${entry.id}`, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/60"
    >
      <Icon
        className={`size-3.5 shrink-0 ${entry.kind === "directory" ? "text-primary" : "text-muted-foreground"}`}
      />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {entry.pinned && <Pin className="size-3 shrink-0 text-primary" />}
    </button>
  );
};

export default FolioTreeSearchRow;
