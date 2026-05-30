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
import { currentArchiveContentsAtom } from "../../atoms/currentArchiveContentsAtom.ts";
import { currentArchivePathAtom } from "../../atoms/currentArchivePathAtom.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";

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

const ARCHIVE_BLOB_BUCKET = "archive-blobs";

/**
 * Drive-like browser for the Archive — folios + blobs + sub-directories
 * under one tree. Single full-pane view with breadcrumb, table, per-row
 * action dropdown, and bulk actions when rows are checked.
 *
 * Current directory persists in `?dir=<shortId>` so back-button works
 * and the URL is shareable. Empty `?dir` → campaign root.
 */
const ArchiveBrowser = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const alepha = useAlepha();
  const directoryApi = useClient<DirectoryController>();
  const blobApi = useClient<BlobController>();
  const folioApi = useClient<FolioController>();
  const [campaign] = useStore(currentCampaignAtom);
  const campaignId = campaign?.id;
  const campaignIdStr = campaign ? String(campaign.id) : "";

  // Contents flow through an atom so the `campaignFolios` route loader
  // can pre-fetch them: the page renders with data already in hand,
  // no "Loading…" flash on first navigation. We still fetch in a
  // useEffect when the URL `?dir` changes mid-session and the atom
  // doesn't match the requested directory.
  const [atomContents, setAtomContents] = useStore(currentArchiveContentsAtom);
  const contents = (atomContents ?? null) as ContentsResponse | null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTargets, setMoveTargets] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Entry[] | null>(null);

  // List vs Grid is per-browser, per-campaign. localStorage survives
  // reload; the campaign id keys it so different campaigns can have
  // different preferences. Default to "list" — it's denser and matches
  // the historical layout, so existing users see no surprise.
  const viewKey = `lor.archive.view.${campaign?.id ?? "default"}`;
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
  // "Archive" entry while in `?dir=5` didn't refresh the table.
  const routerState = useRouterState();
  const dirShortId = useMemo<number | undefined>(() => {
    const raw = routerState.query?.dir;
    if (!raw) return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  }, [routerState.query?.dir]);

  const refresh = useCallback(async () => {
    if (campaignId === undefined) return;
    let parentId: string | undefined;
    if (dirShortId !== undefined) {
      try {
        const directory = await directoryApi.getDirectoryByShortId({
          params: { campaignId, shortId: dirShortId },
        });
        parentId = directory.id;
      } catch {
        // Stale URL pointing at a deleted directory — fall back to root.
        parentId = undefined;
      }
    }
    const result = (await directoryApi.listContents({
      params: { campaignId },
      query: { parentId },
    })) as ContentsResponse;
    setAtomContents(result);
    setSelected(new Set());
    // Mirror the path into the AppShell breadcrumb atom (Lore › Archive
    // › <dirs…>). Atom holds everything after "Archive".
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
    alepha.store.set(currentArchivePathAtom, segments);
  }, [campaignId, dirShortId, directoryApi, alepha, setAtomContents]);

  // Refetch only when the URL `?dir` shifts away from what the atom
  // already holds — typically when the user navigates between dirs
  // inside the SPA (the route loader hydrated the first paint). Avoids
  // double-fetching the data the loader just produced.
  //
  // Even when the cached contents match the URL dir (so we skip the
  // fetch), we MUST re-sync `currentArchivePathAtom` from the cached
  // contents: when the user navigates folio → dir via the breadcrumb,
  // the folio loader left a trailing `{ name: folio.title }` segment
  // on the atom, and without this re-sync the breadcrumb keeps
  // showing the folio title even though the page is now the dir
  // listing.
  useEffect(() => {
    const atomShortId = contents?.directory?.shortId;
    const matches = (atomShortId ?? undefined) === dirShortId;
    if (!matches) {
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
    alepha.store.set(currentArchivePathAtom, segments);
  }, [dirShortId, contents, refresh, alepha]);

  // Campaign-wide search — debounce input, swap table contents for
  // matching folios + blobs + directories. Empty query restores the
  // current-directory listing.
  useEffect(() => {
    if (campaignId === undefined) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const result = await directoryApi.searchArchive({
          params: { campaignId },
          query: { q: trimmed },
        });
        setSearchResults(result.entries as Entry[]);
      } catch {
        setSearchResults([]);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, campaignId, directoryApi]);

  const navigateTo = async (shortId: number | undefined) => {
    const base = router.path("campaignFolios", {
      params: { campaignId: campaignIdStr },
    });
    const target = shortId === undefined ? base : `${base}?dir=${shortId}`;
    await router.push(target);
  };

  // -------------------------- toolbar actions ------------------------------

  const handleNewDirectory = async () => {
    if (campaignId === undefined) return;
    // No description — the dialog is one input + a confirm. Anything
    // else (collision auto-suffix, etc.) happens server-side and the
    // user sees the result. The Input is already autoFocused by the
    // alepha-ui prompt primitive.
    const name = await dialog.prompt({
      title: tr("archive.new-directory"),
    });
    if (!name) return;
    await directoryApi.createDirectory({
      params: { campaignId },
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
    if (!fileList || fileList.length === 0 || campaignId === undefined) return;
    const directoryId = contents?.directory?.id;
    try {
      for (const file of Array.from(fileList)) {
        const fileId = await uploadAndRegister(file, campaignId, directoryId);
        void fileId;
      }
      await refresh();
    } catch (err) {
      console.error("archive upload failed", err);
      window.alert(tr("archive.upload.failed"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /**
   * Two-step upload: POST the bytes to the framework `/api/files`
   * endpoint (bucket=archive-blobs), then POST the returned fileId to
   * the Lore-side `/api/campaigns/:id/archive/blobs` to wire the
   * directory + name + per-campaign shortId.
   */
  const uploadAndRegister = async (
    file: File,
    cId: number,
    directoryId: string | undefined,
  ): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const url = `/api/files?bucket=${encodeURIComponent(ARCHIVE_BLOB_BUCKET)}`;
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
      params: { campaignId: cId },
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
        window.alert(tr("archive.download.protected"));
        return;
      }
      const markdown = buildFolioMarkdown(folio);
      const filename = `${slugify(folio.title)}.md`;
      triggerDownload(filename, markdown, "text/markdown;charset=utf-8");
    }
  };

  const handleRename = async (entry: Entry) => {
    const next = await dialog.prompt({
      title: tr("archive.action.rename-prompt"),
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
    if (entry.kind !== "folio" || campaignId === undefined) return;
    // Fetch + recreate. Blob duplicate would require re-uploading bytes
    // which v1 skips; directory duplicate would require recursive copy.
    const folio = await folioApi.get({ params: { id: entry.id } });
    await folioApi.create({
      body: {
        campaignId,
        title: `${folio.title}${tr("archive.action.duplicate-suffix")}`,
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
    const typeLabel = tr(`archive.type.${entry.kind}`);
    const confirmed = await dialog.confirm({
      title: String(
        tr("archive.action.delete-confirm-title", {
          args: [typeLabel, entry.name],
        }),
      ),
      description: String(
        tr(
          entry.kind === "directory"
            ? "archive.action.delete-confirm-body-cascade"
            : "archive.action.delete-confirm-body",
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
        tr("archive.bulk.delete-confirm-title", {
          args: [String(selected.size)],
        }),
      ),
      description: tr("archive.bulk.delete-confirm-body"),
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

  if (campaignId === undefined) return null;
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
  // campaign root regardless of where the user clicked from.
  const newFolioBase = router.path("campaignFoliosNew", {
    params: { campaignId: campaignIdStr },
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
            ("Lore › Archive › …") is fed by `currentArchivePathAtom`. */}
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
                placeholder={tr("archive.search.placeholder")}
                className="pl-9"
              />
              {searching && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={tr("archive.bulk.clear")}
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
                      aria-label={tr("archive.sort.label")}
                    />
                  }
                >
                  <ArrowUpDown className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(
                    [
                      ["name", "archive.sort.name"],
                      ["type", "archive.sort.type"],
                      ["size", "archive.sort.size"],
                      ["updated", "archive.sort.updated"],
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
                render={<Button size="sm" aria-label={tr("archive.create")} />}
              >
                <Plus className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<Link href={newFolioHref} />}>
                  <FileText className="size-4" />
                  {tr("archive.create.folio")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleNewDirectory}>
                  <FolderPlus className="size-4" />
                  {tr("archive.create.directory")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleUploadClick}>
                  <Upload className="size-4" />
                  {tr("archive.create.upload")}
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
                      {tr("archive.view.list")}
                    </span>
                  ),
                },
                {
                  value: "grid",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <LayoutGrid className="size-3.5" />
                      {tr("archive.view.grid")}
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
                {tr("archive.search.empty", { args: [query.trim()] })}
              </p>
            </>
          ) : (
            <>
              <Folder className="size-10 opacity-30" />
              <p className="text-foreground text-base font-medium">
                {tr("archive.empty.title")}
              </p>
              <p className="text-xs">{tr("archive.empty")}</p>
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
                      ["name", "archive.col.name"],
                      ["type", "archive.col.type"],
                      ["size", "archive.col.size"],
                      ["updated", "archive.col.updated"],
                    ] as const
                  ).map(([field, key]) => (
                    <th key={field} className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => cycleSort(field)}
                        aria-label={tr("archive.sort.label")}
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
                    <span className="sr-only">{tr("archive.col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedEntries.map((e) => (
                  <ArchiveRow
                    key={entryKey(e)}
                    entry={e}
                    campaignIdStr={campaignIdStr}
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
            <ArchiveCard
              key={entryKey(e)}
              entry={e}
              campaignIdStr={campaignIdStr}
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
          campaignId={campaignId}
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

interface ArchiveRowProps {
  entry: Entry;
  campaignIdStr: string;
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

const ArchiveRow = (props: ArchiveRowProps): ReactElement => {
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
          href={props.router.path("campaignFoliosFolio", {
            params: { campaignId: props.campaignIdStr, shortId: e.shortId },
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
          {tr(`archive.type.${e.kind}` as "archive.type.directory")}
        </td>
        <td className={`${cellClass} text-muted-foreground text-xs`}>
          {e.kind === "blob" && e.size !== undefined ? formatBytes(e.size) : ""}
        </td>
        <td className={`${cellClass} text-muted-foreground text-xs`}>
          {props.fromNow}
        </td>
        <td className={cellClass}>
          <ArchiveActionMenu
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
          {tr("archive.action.rename")}
        </ContextMenuItem>
        <ContextMenuItem onClick={props.onMove}>
          <Move className="size-4" />
          {tr("archive.action.move")}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={props.onDelete}>
          <Trash2 className="size-4" />
          {tr("archive.action.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

interface ArchiveActionMenuProps {
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
const ArchiveActionMenu = (props: ArchiveActionMenuProps) => {
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
            aria-label={tr("archive.col.actions")}
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
            {tr("archive.action.download")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={props.onRename}>
          <Pencil className="size-4" />
          {tr("archive.action.rename")}
        </DropdownMenuItem>
        {e.kind === "folio" && (
          <DropdownMenuItem onClick={props.onDuplicate}>
            <Copy className="size-4" />
            {tr("archive.action.duplicate")}
          </DropdownMenuItem>
        )}
        {e.kind === "folio" && (
          <DropdownMenuItem onClick={props.onTogglePin}>
            {e.pinned ? (
              <PinOff className="size-4" />
            ) : (
              <Pin className="size-4" />
            )}
            {tr(e.pinned ? "archive.action.unpin" : "archive.action.pin")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={props.onMove}>
          <Move className="size-4" />
          {tr("archive.action.move")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={props.onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4" />
          {tr("archive.action.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface ArchiveCardProps {
  entry: Entry;
  campaignIdStr: string;
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
const ArchiveCard = (props: ArchiveCardProps) => {
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
      props.router.push("campaignFoliosFolio", {
        params: {
          campaignId: props.campaignIdStr,
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
        <ArchiveActionMenu
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
            <img
              src={`/api/files/${e.id}`}
              alt=""
              loading="lazy"
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
  campaignId: number;
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
      .listAllDirectories({ params: { campaignId: props.campaignId } })
      .then((rows) => setDirs(rows as DirectoryRef[]))
      .catch(() => setDirs([]));
  }, [directoryApi, props.campaignId]);

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
      ? tr("archive.move.title", { args: [props.targets[0].name] })
      : tr("archive.move.title-bulk", {
          args: [String(props.targets.length)],
        });

  return (
    <Dialog open onOpenChange={(open) => !open && props.onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{tr("archive.move.helper")}</DialogDescription>
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
            {tr("archive.move.root")}
          </button>
          {choices.length === 0 && (
            <div className="text-muted-foreground px-3 py-2 text-xs italic">
              {tr("archive.move.empty")}
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
            {tr("archive.move.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={picked === undefined}>
            {tr("archive.move.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Build the markdown export for a folio. YAML frontmatter on top with
 * the metadata we keep (shortId, title, tags, summary, createdAt,
 * updatedAt, pinned). Body is the original markdown content.
 */
const buildFolioMarkdown = (folio: {
  shortId: number;
  title: string;
  tags: string[];
  summary?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
}): string => {
  const escapeYaml = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const lines = ["---"];
  lines.push(`shortId: ${folio.shortId}`);
  lines.push(`title: "${escapeYaml(folio.title)}"`);
  if (folio.tags && folio.tags.length > 0) {
    lines.push(
      `tags: [${folio.tags.map((t) => `"${escapeYaml(t)}"`).join(", ")}]`,
    );
  } else {
    lines.push("tags: []");
  }
  if (folio.summary?.trim()) {
    lines.push(`summary: "${escapeYaml(folio.summary.trim())}"`);
  }
  lines.push(`pinned: ${folio.pinned ? "true" : "false"}`);
  lines.push(`createdAt: ${folio.createdAt}`);
  lines.push(`updatedAt: ${folio.updatedAt}`);
  lines.push("---", "");
  lines.push(folio.content ?? "");
  return lines.join("\n");
};

/**
 * Drive-safe filename slug — keep letters, digits, dot, dash,
 * underscore; collapse anything else to underscore. Lowercased.
 */
const slugify = (title: string): string =>
  (title.trim() || "folio")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100) || "folio";

/**
 * Browser-side download trigger via an in-memory blob URL. Works
 * synchronously, no server round-trip.
 */
const triggerDownload = (filename: string, body: string, mime: string) => {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
        aria-label={tr("archive.bulk.clear")}
      >
        <X className="size-3.5" />
      </Button>
      <span className="text-foreground px-1">
        {tr("archive.bulk.selected", { args: [String(props.count)] })}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="hover:text-destructive size-7"
        onClick={props.onDelete}
        aria-label={tr("archive.bulk.delete")}
      >
        <Trash2 className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={props.onMove}
        aria-label={tr("archive.action.move")}
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

export default ArchiveBrowser;
