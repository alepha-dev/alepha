import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@alepha/ui/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { Input } from "@alepha/ui/components/ui/input";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter, useRouterState } from "alepha/react/router";
import {
  ArrowUpDown,
  Copy,
  Download,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  Move,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BlobController } from "@/api/controllers/BlobController.ts";
import type { DirectoryController } from "@/api/controllers/DirectoryController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentFolioContentsAtom } from "../../atoms/currentFolioContentsAtom.ts";
import { currentFolioPathAtom } from "../../atoms/currentFolioPathAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import {
  folioExportFilename,
  folioMarkdownExport,
  triggerFolioDownload,
} from "./editor/document/folioMarkdownExport.ts";

type EntryKind = "directory" | "folio" | "blob";

type Entry = {
  kind: EntryKind;
  id: string;
  shortId: number;
  name: string;
  updatedAt: string;
  tags?: string[];
  protected?: boolean;
  pinned?: boolean;
  summary?: string;
  size?: number;
  mimeType?: string;
};

interface ContentsResponse {
  directory?: { id: string; shortId: number; name: string; parentId?: string };
  breadcrumb: { id: string; shortId: number; name: string }[];
  entries: Entry[];
}

interface DirectoryRef {
  id: string;
  shortId: number;
  name: string;
  parentId?: string;
}

// Bucket value stays "archive-blobs" — see the note on
// `FOLIO_BLOB_BUCKET` in `FolioBlobService.ts`.
const FOLIO_BLOB_BUCKET = "archive-blobs";

/**
 * Drive-like browser for Folios — folios + blobs + sub-directories
 * under one tree. Single full-pane view with breadcrumb, table, per-row
 * action dropdown, and bulk actions when rows are checked.
 *
 * Current directory persists in `?dir=<shortId>` so back-button works
 * and the URL is shareable. Empty `?dir` → project root.
 */
const FolioBrowser = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const alepha = useAlepha();
  const directoryApi = useClient<DirectoryController>();
  const blobApi = useClient<BlobController>();
  const folioApi = useClient<FolioController>();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id;
  const projectIdStr = project ? String(project.id) : "";

  // Contents flow through an atom so the `projectFolios` route loader
  // can pre-fetch them: the page renders with data already in hand,
  // no "Loading…" flash on first navigation. We still fetch in a
  // useEffect when the URL `?dir` changes mid-session and the atom
  // doesn't match the requested directory.
  const [atomContents, setAtomContents] = useStore(currentFolioContentsAtom);
  const contents = (atomContents ?? null) as ContentsResponse | null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTargets, setMoveTargets] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Entry[] | null>(null);

  // List vs Grid is per-browser, per-project. localStorage survives
  // reload; the project id keys it so different projects can have
  // different preferences. Default to "list" — it's denser and matches
  // the historical layout, so existing users see no surprise.
  const viewKey = `lor.folio.view.${project?.id ?? "default"}`;
  const [view, setView] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    const raw = window.localStorage.getItem(viewKey);
    return raw === "grid" ? "grid" : "list";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(viewKey, view);
  }, [view, viewKey]);

  // Sort by one of name/type/size/updated, asc/desc, or none (server's
  // natural order). 3-way cycle on header click: none → asc → desc → none.
  type SortField = "name" | "type" | "size" | "updated";
  type SortDir = "asc" | "desc";
  const [sort, setSort] = useState<{ field: SortField | null; dir: SortDir }>({
    field: null,
    dir: "asc",
  });
  // Header click: cycle the picked column. Same column re-click flips
  // asc → desc → back to none. Different column starts at asc.
  const cycleSort = (field: SortField) => {
    setSort((s) => {
      if (s.field !== field) return { field, dir: "asc" };
      if (s.dir === "asc") return { field, dir: "desc" };
      return { field: null, dir: "asc" };
    });
  };

  // Read the current directory from the router state's query map so
  // any in-app navigation (breadcrumb click, Link, router.push) triggers
  // a re-render. The earlier window.location-based read only updated on
  // browser back/forward (popstate), so clicking the AppShell breadcrumb
  // "Folio" entry while in `?dir=5` didn't refresh the table.
  const routerState = useRouterState();
  const dirShortId = useMemo<number | undefined>(() => {
    const raw = routerState.query?.dir;
    if (!raw) return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [routerState.query?.dir]);

  const refresh = useCallback(async () => {
    if (projectId === undefined) return;
    let parentId: string | undefined;
    if (dirShortId !== undefined) {
      try {
        const directory = await directoryApi.getDirectoryByShortId({
          params: { projectId, shortId: dirShortId },
        });
        parentId = directory.id;
      } catch {
        // Stale URL pointing at a deleted directory — fall back to root.
        parentId = undefined;
      }
    }
    const result = (await directoryApi.listContents({
      params: { projectId },
      query: { parentId },
    })) as ContentsResponse;
    setAtomContents(result);
    setSelected(new Set());
    // Mirror the path into the AppShell breadcrumb atom (Lore › Folio
    // › <dirs…>). Atom holds everything after "Folio".
    const segments = [
      ...result.breadcrumb.map((b) => ({
        name: b.name,
        shortId: b.shortId,
      })),
    ];
    if (result.directory) {
      segments.push({
        name: result.directory.name,
        shortId: result.directory.shortId,
      });
    }
    alepha.store.set(currentFolioPathAtom, segments);
  }, [projectId, dirShortId, directoryApi, alepha, setAtomContents]);

  // FolioBrowser unmounts when a folio child route is shown (see
  // FoliosLayout) and remounts on return. `currentFolioContentsAtom` is a
  // GLOBAL atom that persists across that unmount, so on return it can hold
  // contents from the previous visit — stale if a folio was created in this
  // directory while we were on its detail page (the parent `projectFolios`
  // loader does NOT re-run on child → parent nav, so it can't refresh it).
  // A per-mount ref forces one refetch on (re)mount so the listing is always
  // current. Was the source of a flaky e2e: create folio in deep dir →
  // breadcrumb back → folio missing because the `matches` check below skipped
  // the refetch on the stale-but-matching atom.
  const fetchedThisMount = useRef(false);

  // Refetch when the URL `?dir` shifts away from what the atom holds, OR on
  // the first run after (re)mounting. The route loader hydrates the first
  // paint; this keeps the listing fresh without a "Loading…" flash.
  //
  // Even when the cached contents match the URL dir (so we skip the
  // fetch), we MUST re-sync `currentFolioPathAtom` from the cached
  // contents: when the user navigates folio → dir via the breadcrumb,
  // the folio loader left a trailing `{ name: folio.title }` segment
  // on the atom, and without this re-sync the breadcrumb keeps
  // showing the folio title even though the page is now the dir
  // listing.
  useEffect(() => {
    const atomShortId = contents?.directory?.shortId;
    const matches = (atomShortId ?? undefined) === dirShortId;
    if (!matches || !fetchedThisMount.current) {
      fetchedThisMount.current = true;
      refresh();
      return;
    }
    if (!contents) return;
    const segments = [
      ...contents.breadcrumb.map((b) => ({
        name: b.name,
        shortId: b.shortId,
      })),
    ];
    if (contents.directory) {
      segments.push({
        name: contents.directory.name,
        shortId: contents.directory.shortId,
      });
    }
    alepha.store.set(currentFolioPathAtom, segments);
  }, [dirShortId, contents, refresh, alepha]);

  // Project-wide search — debounce input, swap table contents for
  // matching folios + blobs + directories. Empty query restores the
  // current-directory listing.
  useEffect(() => {
    if (projectId === undefined) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const result = await directoryApi.searchFolio({
          params: { projectId },
          query: { q: trimmed },
        });
        setSearchResults(result.entries as Entry[]);
      } catch {
        setSearchResults([]);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, projectId, directoryApi]);

  const navigateTo = async (shortId: number | undefined) => {
    const base = router.path("projectFolios", {
      params: { projectId: projectIdStr },
    });
    const target = shortId === undefined ? base : `${base}?dir=${shortId}`;
    await router.push(target);
  };

  // -------------------------- toolbar actions ------------------------------

  const handleNewDirectory = async () => {
    if (projectId === undefined) return;
    // No description — the dialog is one input + a confirm. Anything
    // else (collision auto-suffix, etc.) happens server-side and the
    // user sees the result. The Input is already autoFocused by the
    // alepha-ui prompt primitive.
    const name = await dialog.prompt({
      title: tr("folio.new-directory"),
    });
    if (!name) return;
    await directoryApi.createDirectory({
      params: { projectId },
      body: { name, parentId: contents?.directory?.id },
    });
    await refresh();
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFilesChosen = async (
    fileList: FileList | null,
  ): Promise<void> => {
    if (!fileList || fileList.length === 0 || projectId === undefined) return;
    const directoryId = contents?.directory?.id;
    try {
      for (const file of Array.from(fileList)) {
        const fileId = await uploadAndRegister(file, projectId, directoryId);
        void fileId;
      }
      await refresh();
    } catch (err) {
      console.error("folio upload failed", err);
      window.alert(tr("folio.upload.failed"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /**
   * Two-step upload: POST the bytes to the framework `/api/files`
   * endpoint (bucket=archive-blobs), then POST the returned fileId to
   * the Lore-side `/api/projects/:id/folio/blobs` to wire the
   * directory + name + per-project shortId.
   */
  const uploadAndRegister = async (
    file: File,
    cId: number,
    directoryId: string | undefined,
  ): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const url = `/api/files?bucket=${encodeURIComponent(FOLIO_BLOB_BUCKET)}`;
    const uploaded = await fetch(url, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    if (!uploaded.ok) {
      throw new Error(`upload failed: ${uploaded.status}`);
    }
    const uploadedJson = (await uploaded.json()) as { id: string };
    await blobApi.registerBlob({
      params: { projectId: cId },
      body: {
        fileId: uploadedJson.id,
        name: file.name,
        directoryId,
      },
    });
    return uploadedJson.id;
  };

  // -------------------------- per-row actions ------------------------------

  const handleDownload = async (entry: Entry) => {
    if (entry.kind === "blob") {
      // Framework streams the bytes with Content-Disposition from
      // the file's originalName when present.
      window.open(`/api/files/${entry.id}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (entry.kind === "folio") {
      // Build a Markdown export with a YAML frontmatter block client-
      // side — no server round-trip beyond the existing `get`. Skip
      // protected folios (content is ciphertext; would need passphrase
      // + client-side decrypt to be useful).
      const folio = await folioApi.get({ params: { id: entry.id } });
      if (folio.protected) {
        window.alert(tr("folio.download.protected"));
        return;
      }
      const markdown = folioMarkdownExport(folio);
      const filename = `${folioExportFilename(folio.title)}.md`;
      triggerFolioDownload(filename, markdown, "text/markdown;charset=utf-8");
    }
  };

  const handleRename = async (entry: Entry) => {
    const next = await dialog.prompt({
      title: tr("folio.action.rename-prompt"),
      defaultValue: entry.name,
    });
    if (!next || next === entry.name) return;
    if (entry.kind === "directory") {
      await directoryApi.renameDirectory({
        params: { id: entry.id },
        body: { name: next },
      });
    } else if (entry.kind === "blob") {
      await blobApi.renameBlob({
        params: { id: entry.id },
        body: { name: next },
      });
    } else {
      await folioApi.update({
        params: { id: entry.id },
        body: { title: next },
      });
    }
    await refresh();
  };

  const handleDuplicate = async (entry: Entry) => {
    if (entry.kind !== "folio" || projectId === undefined) return;
    // Fetch + recreate. Blob duplicate would require re-uploading bytes
    // which v1 skips; directory duplicate would require recursive copy.
    const folio = await folioApi.get({ params: { id: entry.id } });
    await folioApi.create({
      body: {
        projectId,
        title: `${folio.title}${tr("folio.action.duplicate-suffix")}`,
        content: folio.content,
        tags: folio.tags,
        summary: folio.summary,
        directoryId: contents?.directory?.id,
        // Duplicate as plaintext — preserving the protected envelope
        // without re-encrypting is meaningless (same passphrase, same
        // ciphertext). User can re-protect manually.
      },
    });
    await refresh();
  };

  const handleTogglePin = async (entry: Entry) => {
    if (entry.kind !== "folio") return;
    await folioApi.update({
      params: { id: entry.id },
      body: { pinned: !entry.pinned },
    });
    await refresh();
  };

  // Move a single entry to a target directory id (or undefined for root).
  // Same per-kind dispatch the MoveDialog uses, lifted out so the
  // drag-and-drop handler can call it directly without going through a
  // dialog.
  const moveEntryTo = async (
    entry: Entry,
    newDirectoryId: string | undefined,
  ) => {
    if (entry.kind === "directory") {
      await directoryApi.moveDirectory({
        params: { id: entry.id },
        body: { parentId: newDirectoryId },
      });
    } else if (entry.kind === "blob") {
      await blobApi.moveBlob({
        params: { id: entry.id },
        body: { directoryId: newDirectoryId },
      });
    } else {
      await folioApi.update({
        params: { id: entry.id },
        body: { directoryId: newDirectoryId ?? null },
      });
    }
  };

  // dnd-kit drop handler. Drop targets are directory rows (data carries
  // `{ directoryId }`). No-op when:
  // - drop outside any target
  // - source == target (dir dropped on itself)
  // - source already lives in that directory
  // The pointer sensor's 6px activation distance keeps plain clicks
  // (navigate, checkbox, link) untouched.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const handleDragEnd = async (event: DragEndEvent) => {
    if (!event.over) return;
    const source = event.active.data.current?.entry as Entry | undefined;
    const targetDirId = event.over.data.current?.directoryId as
      | string
      | undefined;
    if (!source) return;
    // Dropping a directory onto itself is a no-op (server would reject).
    if (source.kind === "directory" && source.id === targetDirId) return;
    try {
      await moveEntryTo(source, targetDirId);
      await refresh();
    } catch {
      // Server validates parent/scope; on rejection the UI just rebounds.
      await refresh();
    }
  };

  const handleDelete = async (entry: Entry) => {
    const typeLabel = tr(`folio.type.${entry.kind}`);
    const confirmed = await dialog.confirm({
      title: String(
        tr("folio.action.delete-confirm-title", {
          args: [typeLabel, entry.name],
        }),
      ),
      description: String(
        tr(
          entry.kind === "directory"
            ? "folio.action.delete-confirm-body-cascade"
            : "folio.action.delete-confirm-body",
        ),
      ),
    });
    if (!confirmed) return;
    if (entry.kind === "directory") {
      await directoryApi.deleteDirectory({
        params: { id: entry.id },
        query: { cascade: true },
      });
    } else if (entry.kind === "blob") {
      await blobApi.deleteBlob({ params: { id: entry.id } });
    } else {
      await folioApi.delete({ params: { id: entry.id } });
    }
    await refresh();
  };

  // -------------------------- bulk actions ---------------------------------

  const toggleRow = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (!contents) return;
    setSelected((prev) => {
      if (prev.size === contents.entries.length) return new Set();
      return new Set(contents.entries.map((e) => entryKey(e)));
    });
  };

  const handleBulkDelete = async () => {
    if (!contents || selected.size === 0) return;
    const confirmed = await dialog.confirm({
      title: String(
        tr("folio.bulk.delete-confirm-title", {
          args: [String(selected.size)],
        }),
      ),
      description: tr("folio.bulk.delete-confirm-body"),
    });
    if (!confirmed) return;
    for (const entry of contents.entries) {
      if (!selected.has(entryKey(entry))) continue;
      if (entry.kind === "directory") {
        await directoryApi.deleteDirectory({
          params: { id: entry.id },
          query: { cascade: true },
        });
      } else if (entry.kind === "blob") {
        await blobApi.deleteBlob({ params: { id: entry.id } });
      } else {
        await folioApi.delete({ params: { id: entry.id } });
      }
    }
    await refresh();
  };

  if (projectId === undefined) return null;
  if (!contents) {
    return (
      <div className="text-muted-foreground p-8 text-sm">{tr("loading")}</div>
    );
  }

  const searching = query.trim().length > 0;
  const baseEntries: Entry[] = searching
    ? (searchResults ?? [])
    : contents.entries;
  // Directories always pin to the top (Finder/Drive convention); within
  // each kind-block we sort by the picked field/direction — or leave
  // server order when no field is picked. Inline (not useMemo) because
  // we're past the early-returns above — useMemo would violate the
  // rules-of-hooks.
  const cmp = (a: Entry, b: Entry, field: SortField): number => {
    switch (field) {
      case "name":
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      case "type":
        return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
      case "size":
        return (a.size ?? 0) - (b.size ?? 0);
      case "updated":
        return a.updatedAt.localeCompare(b.updatedAt);
    }
  };
  const sortSign = sort.dir === "asc" ? 1 : -1;
  const sorter =
    sort.field === null
      ? null
      : (a: Entry, b: Entry) => sortSign * cmp(a, b, sort.field as SortField);
  const dirs = baseEntries.filter((e) => e.kind === "directory");
  const rest = baseEntries.filter((e) => e.kind !== "directory");
  const displayedEntries: Entry[] = sorter
    ? [...dirs.sort(sorter), ...rest.sort(sorter)]
    : [...dirs, ...rest];
  const allChecked =
    displayedEntries.length > 0 && selected.size === displayedEntries.length;
  // Preserve the current directory across the "New folio" navigation
  // — without `?dir=<shortId>` the editor creates the folio at the
  // project root regardless of where the user clicked from.
  const newFolioBase = router.path("projectFoliosNew", {
    params: { projectId: projectIdStr },
  });
  const newFolioHref = dirShortId
    ? `${newFolioBase}?dir=${dirShortId}`
    : newFolioBase;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-col gap-3">
        {/* Single toolbar row:
              [Bulk chip | empty fixed-width]  [Search centered]  [Sort + + + view fixed-width]
            Both side columns are pinned to the same width so the search
            bar doesn't shift horizontally when the bulk chip appears or
            disappears. Mobile: stacks vertically (single column).
            In-page breadcrumb was dropped — AppShell's header breadcrumb
            ("Lore › Folio › …") is fed by `currentFolioPathAtom`. */}
        <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[14rem_1fr_14rem]">
          <div>
            {selected.size > 0 && (
              <BulkSelectionChip
                count={selected.size}
                onClear={() => setSelected(new Set())}
                onDelete={handleBulkDelete}
                onMove={() => {
                  if (!contents) return;
                  const targets = contents.entries.filter((e) =>
                    selected.has(entryKey(e)),
                  );
                  if (targets.length > 0) setMoveTargets(targets);
                }}
              />
            )}
          </div>

          <div className="flex w-full sm:justify-center">
            <div className="relative w-full sm:max-w-md">
              <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr("folio.search.placeholder")}
                className="pl-9"
              />
              {searching && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={tr("folio.bulk.clear")}
                  className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {/* Sort dropdown only in grid view — list view sorts via the
                clickable column headers below. */}
            {view === "grid" && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={tr("folio.sort.label")}
                    />
                  }
                >
                  <ArrowUpDown className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(
                    [
                      ["name", "folio.sort.name"],
                      ["type", "folio.sort.type"],
                      ["size", "folio.sort.size"],
                      ["updated", "folio.sort.updated"],
                    ] as const
                  ).map(([field, key]) => (
                    <DropdownMenuItem
                      key={field}
                      onClick={() => cycleSort(field)}
                    >
                      <span className="flex w-full items-center justify-between gap-3">
                        <span>{tr(key)}</span>
                        {sort.field === field && (
                          <span className="text-muted-foreground text-xs">
                            {sort.dir === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="sm" aria-label={tr("folio.create")} />}
              >
                <Plus className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<Link href={newFolioHref} />}>
                  <FileText className="size-4" />
                  {tr("folio.create.folio")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleNewDirectory}>
                  <FolderPlus className="size-4" />
                  {tr("folio.create.directory")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleUploadClick}>
                  <Upload className="size-4" />
                  {tr("folio.create.upload")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Segmented
              size="sm"
              value={view}
              onChange={(v) => setView(v === "grid" ? "grid" : "list")}
              options={[
                {
                  value: "list",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <List className="size-3.5" />
                      {tr("folio.view.list")}
                    </span>
                  ),
                },
                {
                  value: "grid",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <LayoutGrid className="size-3.5" />
                      {tr("folio.view.grid")}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFilesChosen(e.target.files)}
        />
      </header>

      {displayedEntries.length === 0 ? (
        <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-3 text-center">
          {searching ? (
            <>
              <Search className="size-10 opacity-30" />
              <p className="text-sm">
                {tr("folio.search.empty", { args: [query.trim()] })}
              </p>
            </>
          ) : (
            <>
              <Folder className="size-10 opacity-30" />
              <p className="text-foreground text-base font-medium">
                {tr("folio.empty.title")}
              </p>
              <p className="text-xs">{tr("folio.empty")}</p>
            </>
          )}
        </div>
      ) : view === "list" ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={() => toggleAll()}
                      aria-label="Select all"
                    />
                  </th>
                  {(
                    [
                      ["name", "folio.col.name"],
                      ["type", "folio.col.type"],
                      ["size", "folio.col.size"],
                      ["updated", "folio.col.updated"],
                    ] as const
                  ).map(([field, key]) => (
                    <th key={field} className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => cycleSort(field)}
                        aria-label={tr("folio.sort.label")}
                        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
                      >
                        <span>{tr(key)}</span>
                        <span
                          aria-hidden
                          className="text-muted-foreground/70 text-[10px]"
                        >
                          {sort.field === field
                            ? sort.dir === "asc"
                              ? "↑"
                              : "↓"
                            : ""}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="w-12 px-3 py-2 font-medium">
                    <span className="sr-only">{tr("folio.col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedEntries.map((e) => (
                  <FolioRow
                    key={entryKey(e)}
                    entry={e}
                    projectIdStr={projectIdStr}
                    router={router}
                    fromNow={dt.of(e.updatedAt).fromNow()}
                    selected={selected.has(entryKey(e))}
                    onToggleSelect={() => toggleRow(entryKey(e))}
                    onNavigate={() => navigateTo(e.shortId)}
                    onDownload={() => handleDownload(e)}
                    onRename={() => handleRename(e)}
                    onDuplicate={() => handleDuplicate(e)}
                    onTogglePin={() => handleTogglePin(e)}
                    onMove={() => setMoveTargets([e])}
                    onDelete={() => handleDelete(e)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </DndContext>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {displayedEntries.map((e) => (
            <FolioCard
              key={entryKey(e)}
              entry={e}
              projectIdStr={projectIdStr}
              router={router}
              selected={selected.has(entryKey(e))}
              onToggleSelect={() => toggleRow(entryKey(e))}
              onNavigate={() => navigateTo(e.shortId)}
              onDownload={() => handleDownload(e)}
              onRename={() => handleRename(e)}
              onDuplicate={() => handleDuplicate(e)}
              onTogglePin={() => handleTogglePin(e)}
              onMove={() => setMoveTargets([e])}
              onDelete={() => handleDelete(e)}
            />
          ))}
        </div>
      )}

      {moveTargets && (
        <MoveDialog
          targets={moveTargets}
          projectId={projectId}
          onCancel={() => setMoveTargets(null)}
          onMoved={async () => {
            setMoveTargets(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
};

const entryKey = (e: Entry) => `${e.kind}:${e.id}`;

interface FolioRowProps {
  entry: Entry;
  projectIdStr: string;
  router: ReturnType<typeof useRouter<AppRouter>>;
  fromNow: string;
  selected: boolean;
  onToggleSelect: () => void;
  onNavigate: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onTogglePin: () => void;
  onMove: () => void;
  onDelete: () => void;
}

const FolioRow = (props: FolioRowProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const e = props.entry;
  const cellClass = "border-border/40 border-t px-3 py-2";

  // dnd-kit: every row is draggable. Only directory rows are drop
  // targets — blobs and folios reject drops by leaving useDroppable
  // disabled.
  const draggable = useDraggable({
    id: `row:${entryKey(e)}`,
    data: { entry: e },
  });
  const droppable = useDroppable({
    id: `drop:${entryKey(e)}`,
    data: { directoryId: e.id, kind: "directory" },
    disabled: e.kind !== "directory",
  });
  const setRowRef = (node: HTMLTableRowElement | null) => {
    draggable.setNodeRef(node);
    if (e.kind === "directory") droppable.setNodeRef(node);
  };
  const rowClass = [
    "hover:bg-muted/40 transition-colors",
    draggable.isDragging ? "opacity-50" : "",
    droppable.isOver && e.kind === "directory"
      ? "bg-primary/10 ring-1 ring-primary"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const icon =
    e.kind === "directory" ? (
      <Folder className="text-primary size-4" />
    ) : e.kind === "folio" ? (
      <FileText className="text-muted-foreground size-4" />
    ) : (
      <FileIcon className="text-muted-foreground size-4" />
    );

  const nameCell = (() => {
    if (e.kind === "directory") {
      return (
        <button
          type="button"
          onClick={props.onNavigate}
          className="hover:text-foreground inline-flex items-center gap-2 text-left"
        >
          {icon}
          {e.name}
        </button>
      );
    }
    if (e.kind === "folio") {
      return (
        <Link
          href={props.router.path("projectFoliosFolio", {
            params: { projectId: props.projectIdStr, shortId: e.shortId },
          })}
          className="hover:text-foreground inline-flex items-center gap-2"
        >
          {icon}
          <span>{e.name}</span>
          {e.pinned && <Pin className="text-primary size-3" />}
          {e.tags && e.tags.length > 0 && (
            <span className="ml-1 inline-flex gap-1">
              {e.tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </span>
          )}
        </Link>
      );
    }
    return (
      <span className="inline-flex items-center gap-2">
        {icon}
        {e.name}
      </span>
    );
  })();

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <tr
            ref={setRowRef}
            className={rowClass}
            {...draggable.attributes}
            {...draggable.listeners}
          />
        }
      >
        <td className={cellClass}>
          <Checkbox
            checked={props.selected}
            onCheckedChange={props.onToggleSelect}
            aria-label={`Select ${e.name}`}
          />
        </td>
        <td className={cellClass}>{nameCell}</td>
        <td className={`${cellClass} text-muted-foreground text-xs`}>
          {tr(`folio.type.${e.kind}` as "folio.type.directory")}
        </td>
        <td className={`${cellClass} text-muted-foreground text-xs`}>
          {e.kind === "blob" && e.size !== undefined ? formatBytes(e.size) : ""}
        </td>
        <td className={`${cellClass} text-muted-foreground text-xs`}>
          {props.fromNow}
        </td>
        <td className={cellClass}>
          <FolioActionMenu
            entry={e}
            onDownload={props.onDownload}
            onRename={props.onRename}
            onDuplicate={props.onDuplicate}
            onTogglePin={props.onTogglePin}
            onMove={props.onMove}
            onDelete={props.onDelete}
          />
        </td>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={props.onRename}>
          <Pencil className="size-4" />
          {tr("folio.action.rename")}
        </ContextMenuItem>
        <ContextMenuItem onClick={props.onMove}>
          <Move className="size-4" />
          {tr("folio.action.move")}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={props.onDelete}>
          <Trash2 className="size-4" />
          {tr("folio.action.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

interface FolioActionMenuProps {
  entry: Entry;
  onDownload: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onTogglePin: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/**
 * Shared row/card "..." dropdown. Same item set whether the entry is
 * rendered as a list row or a grid card.
 */
const FolioActionMenu = (props: FolioActionMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const e = props.entry;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={tr("folio.col.actions")}
            // Stop propagation so the surrounding card's click-to-navigate
            // doesn't fire when the user just wanted the action menu.
            onClick={(ev) => ev.stopPropagation()}
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(e.kind === "blob" || e.kind === "folio") && (
          <DropdownMenuItem onClick={props.onDownload}>
            <Download className="size-4" />
            {tr("folio.action.download")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={props.onRename}>
          <Pencil className="size-4" />
          {tr("folio.action.rename")}
        </DropdownMenuItem>
        {e.kind === "folio" && (
          <DropdownMenuItem onClick={props.onDuplicate}>
            <Copy className="size-4" />
            {tr("folio.action.duplicate")}
          </DropdownMenuItem>
        )}
        {e.kind === "folio" && (
          <DropdownMenuItem onClick={props.onTogglePin}>
            {e.pinned ? (
              <PinOff className="size-4" />
            ) : (
              <Pin className="size-4" />
            )}
            {tr(e.pinned ? "folio.action.unpin" : "folio.action.pin")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={props.onMove}>
          <Move className="size-4" />
          {tr("folio.action.move")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={props.onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4" />
          {tr("folio.action.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface FolioCardProps {
  entry: Entry;
  projectIdStr: string;
  router: ReturnType<typeof useRouter<AppRouter>>;
  selected: boolean;
  onToggleSelect: () => void;
  onNavigate: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onTogglePin: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/**
 * Drive-style grid card. The top row is always Icon + Name + [...] dots;
 * directories stop there. Folios + blobs add a preview area below — for
 * image blobs we inline the file via `/api/files/:id`; everything else
 * falls back to a big centered icon.
 */
const FolioCard = (props: FolioCardProps) => {
  const e = props.entry;
  const icon =
    e.kind === "directory" ? (
      <Folder className="text-primary size-4 shrink-0" />
    ) : e.kind === "folio" ? (
      <FileText className="text-muted-foreground size-4 shrink-0" />
    ) : (
      <FileIcon className="text-muted-foreground size-4 shrink-0" />
    );

  const isImage = e.kind === "blob" && (e.mimeType ?? "").startsWith("image/");

  // The folio detail route exists; directories navigate via ?dir, and
  // blobs have no detail page (clicking acts as a download/open).
  const navigate = () => {
    if (e.kind === "directory") {
      props.onNavigate();
    } else if (e.kind === "folio") {
      props.router.push("projectFoliosFolio", {
        params: {
          projectId: props.projectIdStr,
          shortId: String(e.shortId),
        },
      });
    } else {
      props.onDownload();
    }
  };

  return (
    <div
      className={cardOuterClass(props.selected)}
      // Whole-card click navigates. The action menu + checkbox stop
      // propagation so they don't double-trigger.
      onClick={navigate}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") navigate();
      }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Checkbox
          checked={props.selected}
          onCheckedChange={props.onToggleSelect}
          onClick={(ev) => ev.stopPropagation()}
          aria-label={`Select ${e.name}`}
        />
        {icon}
        <span className="flex-1 truncate text-sm" title={e.name}>
          {e.name}
        </span>
        {e.kind === "folio" && e.pinned && (
          <Pin className="text-primary size-3 shrink-0" />
        )}
        <FolioActionMenu
          entry={e}
          onDownload={props.onDownload}
          onRename={props.onRename}
          onDuplicate={props.onDuplicate}
          onTogglePin={props.onTogglePin}
          onMove={props.onMove}
          onDelete={props.onDelete}
        />
      </div>
      {e.kind !== "directory" && (
        <div className="bg-muted/30 border-border/40 flex aspect-video items-center justify-center overflow-hidden border-t">
          {isImage ? (
            <FileImage
              id={e.id}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : e.kind === "folio" ? (
            <FileText className="text-muted-foreground/40 size-12" />
          ) : (
            <FileIcon className="text-muted-foreground/40 size-12" />
          )}
        </div>
      )}
    </div>
  );
};

const cardOuterClass = (selected: boolean): string => {
  // Selected state mirrors the row-level highlight so a multi-select
  // spanning the two layouts (or a layout swap mid-selection) reads
  // consistently.
  const base =
    "group bg-card hover:bg-muted/40 cursor-pointer overflow-hidden rounded-md border transition-colors";
  return selected ? `${base} ring-primary ring-2` : base;
};

interface MoveDialogProps {
  /** One or more entries to move. Single-row Move and bulk Move share this dialog. */
  targets: Entry[];
  projectId: number;
  onCancel: () => void;
  onMoved: () => Promise<void>;
}

const MoveDialog = (props: MoveDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const directoryApi = useClient<DirectoryController>();
  const blobApi = useClient<BlobController>();
  const folioApi = useClient<FolioController>();
  const [dirs, setDirs] = useState<DirectoryRef[] | null>(null);
  const [picked, setPicked] = useState<string | undefined>(undefined);

  useEffect(() => {
    directoryApi
      .listAllDirectories({ params: { projectId: props.projectId } })
      .then((rows) => setDirs(rows as DirectoryRef[]))
      .catch(() => setDirs([]));
  }, [directoryApi, props.projectId]);

  // Cycle prevention: any *directory* in the selection (and all of its
  // descendants) is an invalid destination. Server-side `move` would
  // reject, but pre-filtering keeps the picker honest. Also exclude
  // the parent any selected entry already lives under (no-op move).
  const forbidden = useMemo(() => {
    if (!dirs) return new Set<string>();
    const blocked = new Set<string>();
    for (const target of props.targets) {
      if (target.kind === "directory") blocked.add(target.id);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const d of dirs) {
        if (d.parentId && blocked.has(d.parentId) && !blocked.has(d.id)) {
          blocked.add(d.id);
          changed = true;
        }
      }
    }
    return blocked;
  }, [dirs, props.targets]);

  const choices = useMemo(() => {
    if (!dirs) return [];
    return dirs.filter((d) => !forbidden.has(d.id));
  }, [dirs, forbidden]);

  const handleConfirm = async () => {
    const newDirectoryId = picked === "__root__" ? undefined : picked;
    // Loop per-entry; the move endpoints are single-entity. Fine for
    // the scales we run at (user multi-selects a few rows at most).
    for (const target of props.targets) {
      if (target.kind === "directory") {
        await directoryApi.moveDirectory({
          params: { id: target.id },
          body: { parentId: newDirectoryId },
        });
      } else if (target.kind === "blob") {
        await blobApi.moveBlob({
          params: { id: target.id },
          body: { directoryId: newDirectoryId },
        });
      } else {
        await folioApi.update({
          params: { id: target.id },
          body: { directoryId: newDirectoryId ?? null },
        });
      }
    }
    await props.onMoved();
  };

  const title =
    props.targets.length === 1
      ? tr("folio.move.title", { args: [props.targets[0].name] })
      : tr("folio.move.title-bulk", {
          args: [String(props.targets.length)],
        });

  return (
    <Dialog open onOpenChange={(open) => !open && props.onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{tr("folio.move.helper")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-auto rounded-md border">
          <button
            type="button"
            onClick={() => setPicked("__root__")}
            className={`hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
              picked === "__root__" ? "bg-muted" : ""
            }`}
          >
            <Folder className="text-muted-foreground size-4" />
            {tr("folio.move.root")}
          </button>
          {choices.length === 0 && (
            <div className="text-muted-foreground px-3 py-2 text-xs italic">
              {tr("folio.move.empty")}
            </div>
          )}
          {choices.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setPicked(d.id)}
              className={`hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                picked === d.id ? "bg-muted" : ""
              }`}
            >
              <Folder className="text-primary size-4" />
              {d.name}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onCancel}>
            {tr("folio.move.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={picked === undefined}>
            {tr("folio.move.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Compact chip shown at the bottom-left of the toolbar when ≥1 row is
 * selected. Drive-style: `[× 2 selected] [🗑] [↗]`. Clearing the
 * selection collapses the chip — the (+) "Create" dropdown on the
 * right is always visible regardless.
 */
const BulkSelectionChip = (props: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onMove: () => void;
}) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div className="bg-muted/60 inline-flex items-center gap-1 rounded-full px-1 py-1 text-xs">
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        onClick={props.onClear}
        aria-label={tr("folio.bulk.clear")}
      >
        <X className="size-3.5" />
      </Button>
      <span className="text-foreground px-1">
        {tr("folio.bulk.selected", { args: [String(props.count)] })}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="hover:text-destructive size-7"
        onClick={props.onDelete}
        aria-label={tr("folio.bulk.delete")}
      >
        <Trash2 className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={props.onMove}
        aria-label={tr("folio.action.move")}
      >
        <Move className="size-4" />
      </Button>
    </div>
  );
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export default FolioBrowser;
