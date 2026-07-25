import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DirectoryController } from "@/api/controllers/DirectoryController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { Folio } from "@/api/entities/folios.ts";
import { campaignDirectoriesAtom } from "../../atoms/campaignDirectoriesAtom.ts";
import { userFoliosAtom } from "../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../services/I18n.ts";

/**
 * Read-only campaign archive tree (directories + folios) rendered in
 * the FolioView left side pane (#107). Click a folio leaf → navigates
 * to that folio. Blobs are excluded — you don't navigate to them via
 * the folio view.
 *
 * Designed for quick folio→folio jumping. Fetches the whole campaign's
 * folios + directories once on first mount; small enough to keep
 * in-memory (campaign-bounded).
 */
interface DirectoryNode {
  id: string;
  name: string;
  shortId: number;
  parentId?: string;
}

interface TreeProps {
  campaignId: number;
  currentFolioId?: string;
  campaignIdStr: string;
}

const FolioTreePanel = ({
  campaignId,
  currentFolioId,
  campaignIdStr,
}: TreeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const folioApi = useClient<FolioController>();
  const dirApi = useClient<DirectoryController>();
  // Read pre-populated data from atoms — the folio detail route loader
  // (#109) fuses our three calls into one batch + stashes the results
  // here, so the panel renders from cache on first mount and avoids
  // the extra round-trip. Fallback fetch covers the case where the
  // panel is mounted outside the folio route (atoms empty).
  const [folios, setFolios] = useStore(userFoliosAtom);
  const [dirs, setDirs] = useStore(campaignDirectoriesAtom);
  // Seeded from the atoms the route loader fills, so a warm navigation
  // renders the tree without a fetch or a skeleton frame.
  const seeded = folios.length > 0 || dirs.length > 0;
  // Collapsed state per directory id. Seeded ONCE (see the init effect
  // below) to collapse every directory EXCEPT the ancestors of the
  // current folio; afterwards it is sticky — navigation only expands the
  // new folio's ancestor path, it never re-collapses what the user (or a
  // prior navigation) left open. User toggles override.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Guards the one-time default-collapse. Without it the seed re-ran on
  // every folio→folio navigation (the route loader hands the panel fresh
  // `folios`/`dirs` references each time), collapsing directories the
  // user had open — petition #14.
  const initializedRef = useRef(false);

  // Keyed so the tree is shared with anything else querying the same
  // campaign, and so a folio mutation can invalidate it by prefix instead
  // of hand-patching `userFoliosAtom`. Results are mirrored into the atoms
  // the rest of the archive UI still reads.
  const { loading: fetching, error } = useQuery(
    {
      key: ["folioTree", campaignId],
      enabled: !seeded,
      staleTime: [30, "seconds"],
      handler: async () => {
        const [folioList, dirList] = await Promise.all([
          folioApi.list({ query: { campaignId, limit: 100 } as never }),
          dirApi.listAllDirectories({ params: { campaignId } }),
        ]);
        return { folios: folioList, dirs: dirList as DirectoryNode[] };
      },
      onSuccess: (result) => {
        setFolios(result.folios);
        setDirs(result.dirs);
      },
      // Previously `.catch(() => {})` — the panel silently rendered empty
      // on a failed fetch. Swallow it the same way for the tree (it is a
      // navigation aid, not the page), but keep the error observable.
      onError: () => {},
    },
    [campaignId],
  );

  const loading = !seeded && fetching && !error;

  // Ancestor chain of the current folio's directory (root → leaf). Drives
  // both the one-time seed and the per-navigation "expand the path I just
  // opened" behavior below.
  const ancestorDirIds = useMemo(() => {
    const typedDirs = dirs as DirectoryNode[];
    const dirById = new Map(typedDirs.map((d) => [d.id, d]));
    const current = folios.find((f) => f.id === currentFolioId);
    const ancestors = new Set<string>();
    let cursor: string | undefined = current?.directoryId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      ancestors.add(cursor);
      cursor = dirById.get(cursor)?.parentId;
    }
    return ancestors;
  }, [currentFolioId, folios, dirs]);

  // One-time seed: as soon as data is available, collapse every directory
  // EXCEPT the current folio's ancestor path so the first view is focused.
  // Runs once (guarded) — the per-navigation effect takes over after.
  useEffect(() => {
    if (initializedRef.current) return;
    const typedDirs = dirs as DirectoryNode[];
    if (typedDirs.length === 0 && folios.length === 0) return; // await data
    initializedRef.current = true;
    const defaultCollapsed = new Set<string>();
    for (const d of typedDirs) {
      if (!ancestorDirIds.has(d.id)) defaultCollapsed.add(d.id);
    }
    setCollapsed(defaultCollapsed);
  }, [ancestorDirIds, dirs, folios]);

  // On each later navigation, only EXPAND the new folio's ancestor path
  // (so the highlighted leaf is visible) — never collapse anything else.
  // This is what keeps `features` open when you jump from features/FolioX
  // to a root-level FolioY (petition #14).
  useEffect(() => {
    if (!initializedRef.current) return;
    if (ancestorDirIds.size === 0) return;
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestorDirIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [ancestorDirIds]);

  // Build adjacency: directory id → child dirs + child folios. Root
  // bucket keyed on the special string `__root__`.
  const tree = useMemo(() => {
    const dirsByParent = new Map<string, DirectoryNode[]>();
    for (const d of dirs) {
      const key = d.parentId ?? "__root__";
      const bucket = dirsByParent.get(key) ?? [];
      bucket.push(d);
      dirsByParent.set(key, bucket);
    }
    const foliosByDir = new Map<string, Folio[]>();
    for (const f of folios) {
      const key = f.directoryId ?? "__root__";
      const bucket = foliosByDir.get(key) ?? [];
      bucket.push(f);
      foliosByDir.set(key, bucket);
    }
    // Sort each bucket by name/title for stable display.
    for (const [, arr] of dirsByParent) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    for (const [, arr] of foliosByDir) {
      arr.sort((a, b) => a.title.localeCompare(b.title));
    }
    return { dirsByParent, foliosByDir };
  }, [dirs, folios]);

  const toggle = (dirId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirId)) next.delete(dirId);
      else next.add(dirId);
      return next;
    });
  };

  const renderDirectory = (dir: DirectoryNode, depth: number) => {
    const isCollapsed = collapsed.has(dir.id);
    const childDirs = tree.dirsByParent.get(dir.id) ?? [];
    const childFolios = tree.foliosByDir.get(dir.id) ?? [];
    return (
      <li key={`d:${dir.id}`}>
        <button
          type="button"
          onClick={() => toggle(dir.id)}
          className="hover:bg-muted/50 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {isCollapsed ? (
            <ChevronRight className="size-3 shrink-0 opacity-60" />
          ) : (
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          )}
          {isCollapsed ? (
            <Folder className="text-primary size-3.5 shrink-0" />
          ) : (
            <FolderOpen className="text-primary size-3.5 shrink-0" />
          )}
          <span className="truncate">{dir.name}</span>
        </button>
        {!isCollapsed && (childDirs.length > 0 || childFolios.length > 0) && (
          <ul className="flex flex-col">
            {childDirs.map((d) => renderDirectory(d, depth + 1))}
            {childFolios.map((f) => renderFolio(f, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const renderFolio = (f: Folio, depth: number) => {
    const isCurrent = f.id === currentFolioId;
    return (
      <li key={`f:${f.id}`}>
        <Link
          href={`/c/${campaignIdStr}/archive/${f.shortId}`}
          className={`hover:bg-muted/50 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm ${
            isCurrent ? "font-semibold" : ""
          }`}
          style={{ paddingLeft: `${depth * 12 + 18}px` }}
        >
          <FileText className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate">{f.title}</span>
        </Link>
      </li>
    );
  };

  const rootDirs = tree.dirsByParent.get("__root__") ?? [];
  const rootFolios = tree.foliosByDir.get("__root__") ?? [];

  return (
    <div className="flex flex-col gap-2 p-3">
      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {tr("folios.tree.title")}
      </h3>
      {loading ? (
        <p className="text-muted-foreground text-xs">
          {tr("folios.activity.loading")}
        </p>
      ) : rootDirs.length === 0 && rootFolios.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          {tr("folios.tree.empty")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rootDirs.map((d) => renderDirectory(d, 0))}
          {rootFolios.map((f) => renderFolio(f, 0))}
        </ul>
      )}
    </div>
  );
};

export default FolioTreePanel;
