import { Button } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CornerLeftUp,
  FilePlus,
  FileText,
  FolderPlus,
  Lock,
  Pin,
} from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";

import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import FolioTreeDirectoryIcon from "../tree/FolioTreeDirectoryIcon.tsx";

export interface FolioDirectoryListingProps {
  projectSlug: string;
  /**
   * `?dir=<shortId>` off the URL. Absent, or naming a directory that no
   * longer exists, lists the project root.
   */
  directoryShortId?: number;
  /**
   * Absent when the reader cannot create. Called with the listed directory's
   * id, `undefined` at the root.
   */
  onCreateFolio?: (directoryId?: string) => void;
  onCreateDirectory?: (directoryId?: string) => void;
}

type SortKey = "name" | "updated";

/**
 * What the document pane shows at `/folios` with nothing open: the contents
 * of one directory, the way a file explorer in list view shows a folder.
 *
 * It is not a second navigation competing with the tree (the reason the
 * `FolioBrowser` table went, on 2026-08-08): it fills the pane the tree
 * leaves empty, with what the tree cannot show at its width. The full title,
 * the summary, the last update. Directories come first, as in the tree.
 *
 * The directory is the same `?dir=<shortId>` the tree reveals, so opening a
 * directory here also opens it there. The data is the tree's own two atoms,
 * which the `/folios` loader seeds: there is no fetch of its own.
 */
const FolioDirectoryListing = (
  props: FolioDirectoryListingProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const dateTime = useInject(DateTimeProvider);
  const [folios] = useStore(userFoliosAtom);
  const [directories] = useStore(projectDirectoriesAtom);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "name",
    desc: false,
  });

  const current = directories.find((d) => d.shortId === props.directoryShortId);
  const currentId = current?.id;

  // Root first, current last. The `seen` guard stops a parent cycle, which
  // the tree breaks the same way, from looping here.
  const trail = useMemo(() => {
    const byId = new Map(directories.map((d) => [d.id, d]));
    const out: typeof directories = [];
    const seen = new Set<string>();
    let at = current;
    while (at && !seen.has(at.id)) {
      seen.add(at.id);
      out.unshift(at);
      at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    return out;
  }, [directories, current]);

  const childDirectories = useMemo(
    () =>
      directories
        .filter((d) => (d.parentId ?? undefined) === currentId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [directories, currentId],
  );

  const childFolios = useMemo(() => {
    const list = folios.filter(
      (f) => (f.directoryId ?? undefined) === currentId,
    );
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) =>
      sort.key === "name"
        ? dir * a.title.localeCompare(b.title)
        : dir * (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)),
    );
  }, [folios, currentId, sort]);

  // How many entries each listed directory holds, directly: what a file
  // explorer shows in a folder's size column.
  const sizes = useMemo(() => {
    const count = new Map<string, number>();
    const bump = (id?: string | null) => {
      if (id) count.set(id, (count.get(id) ?? 0) + 1);
    };
    for (const d of directories) bump(d.parentId);
    for (const f of folios) bump(f.directoryId);
    return count;
  }, [directories, folios]);

  const foliosPath = router.path("projectFolios", {
    params: { projectSlug: props.projectSlug },
  });
  const directoryHref = (shortId?: number): string =>
    shortId === undefined ? foliosPath : `${foliosPath}?dir=${shortId}`;

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, desc: !s.desc }
        : // A date reads newest first; a name reads A to Z.
          { key, desc: key === "updated" },
    );

  const SortIcon = sort.desc ? ArrowDown : ArrowUp;
  const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;
  const empty = childDirectories.length === 0 && childFolios.length === 0;
  const rowClass =
    "hover:bg-muted/60 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2 sm:grid-cols-[minmax(0,1fr)_7rem]";

  return (
    <div
      data-slot="folio-directory-listing"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 px-4 py-3">
        <nav
          aria-label={tr("folios.editor.listing.path")}
          className="flex min-w-0 items-center gap-1 text-sm"
        >
          {current ? (
            <Link
              href={directoryHref()}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              {tr("folios.editor.tree.title")}
            </Link>
          ) : (
            <span className="font-medium">
              {tr("folios.editor.tree.title")}
            </span>
          )}
          {trail.map((d, i) => (
            <span key={d.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
              {i === trail.length - 1 ? (
                <span className="truncate font-medium" aria-current="page">
                  {d.name}
                </span>
              ) : (
                <Link
                  href={directoryHref(d.shortId)}
                  className="text-muted-foreground hover:text-foreground truncate"
                >
                  {d.name}
                </Link>
              )}
            </span>
          ))}
        </nav>
        <div className="flex flex-none gap-2">
          {props.onCreateDirectory && (
            <Button
              variant="outlined"
              size="sm"
              onClick={() => props.onCreateDirectory?.(currentId)}
            >
              <FolderPlus className="size-4" />
              {tr("folios.editor.tree.new-directory")}
            </Button>
          )}
          {props.onCreateFolio && (
            <Button
              variant="outlined"
              size="sm"
              onClick={() => props.onCreateFolio?.(currentId)}
            >
              <FilePlus className="size-4" />
              {tr("folios.editor.tree.new-folio")}
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          role="row"
          className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-4 py-1.5 text-xs sm:grid-cols-[minmax(0,1fr)_7rem]"
        >
          <button
            type="button"
            className="hover:text-foreground flex items-center gap-1 text-left"
            onClick={() => toggleSort("name")}
          >
            {tr("folios.editor.listing.name")}
            {sort.key === "name" && <SortIcon className="size-3" />}
          </button>
          <button
            type="button"
            className="hover:text-foreground flex items-center gap-1 text-left"
            onClick={() => toggleSort("updated")}
          >
            {tr("folios.editor.listing.updated")}
            {sort.key === "updated" && <SortIcon className="size-3" />}
          </button>
        </div>

        {current && (
          <Link
            href={directoryHref(parent?.shortId)}
            aria-label={tr("folios.editor.listing.parent")}
            className={`${rowClass} text-muted-foreground text-sm`}
          >
            <span className="flex items-center gap-3">
              <CornerLeftUp className="size-4 shrink-0" />
              ..
            </span>
            <span />
          </Link>
        )}

        {childDirectories.map((d) => {
          const size = sizes.get(d.id) ?? 0;
          return (
            <Link
              key={d.id}
              href={directoryHref(d.shortId)}
              className={`${rowClass} text-sm`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <FolioTreeDirectoryIcon name={d.name} isCollapsed />
                <span className="truncate">{d.name}</span>
              </span>
              <span className="text-muted-foreground text-xs">
                {size === 1
                  ? tr("folios.editor.listing.item")
                  : tr("folios.editor.listing.items", {
                      args: [String(size)],
                    })}
              </span>
            </Link>
          );
        })}

        {childFolios.map((f) => {
          const Icon = f.protected ? Lock : FileText;
          const updated = dateTime.of(f.updatedAt);
          return (
            <Link
              key={f.id}
              href={router.path("projectFoliosFolio", {
                params: { projectSlug: props.projectSlug, shortId: f.shortId },
              })}
              className={`${rowClass} text-sm`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon className="size-3.5 shrink-0 text-[var(--folio-tree-folio)]" />
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{f.title}</span>
                    {f.pinned && (
                      <Pin
                        aria-label={tr("folios.editor.listing.pinned")}
                        className="text-primary size-3 shrink-0"
                      />
                    )}
                  </span>
                  {f.summary && !f.protected && (
                    <span className="text-muted-foreground truncate text-xs">
                      {f.summary}
                    </span>
                  )}
                </span>
              </span>
              <time
                dateTime={f.updatedAt}
                title={updated.format("lll")}
                className="text-muted-foreground text-xs"
              >
                {updated.fromNow()}
              </time>
            </Link>
          );
        })}

        {empty && (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            {current
              ? tr("folios.editor.listing.empty")
              : tr("folios.editor.tree.empty")}
          </p>
        )}
      </div>
    </div>
  );
};

export default FolioDirectoryListing;
