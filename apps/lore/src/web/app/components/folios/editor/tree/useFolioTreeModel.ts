import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { AlephaError } from "alepha";
import {
  useAction,
  useAlepha,
  useClient,
  useQuery,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BlobController } from "@/api/controllers/BlobController.ts";
import type { DirectoryController } from "@/api/controllers/DirectoryController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { AppRouter } from "../../../../AppRouter.ts";
import { pendingFolioTreeRenameAtom } from "../../../../atoms/pendingFolioTreeRenameAtom.ts";
import { projectBlobsAtom } from "../../../../atoms/projectBlobsAtom.ts";
import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import {
  buildFolioTree,
  type FolioDropPosition,
  type FolioTreeNode,
  type FolioTreeRow,
  findFolioNode,
  flattenFolioTree,
  resolveFolioDrop,
} from "./folioTreeModel.ts";

/**
 * Mirrors `FOLIO_BLOB_BUCKET_NAME` (FolioBlobService) — not imported so the
 * browser bundle does not pull the server-side service module. The value stays
 * "archive-blobs": it is persisted on every existing `files` row.
 */
const FOLIO_BLOB_BUCKET = "archive-blobs";

export interface UseFolioTreeModelInput {
  projectId: number;
  projectSlug: string;
  /**
   * The folio open in the document pane, if any. Drives both the
   * highlighted row (`selectedId`) and the ancestor-expansion behavior on
   * navigation — see the file doc below.
   */
  currentFolioId?: string;
}

export interface FolioTreeState {
  rows: FolioTreeRow[];
  /**
   * True while the fallback fetch (see the file doc's "Why this hook has
   * its own `useQuery`" section) is in flight. Not in the brief's stated
   * shape — added so `FolioTree` can avoid flashing the "No folios yet"
   * empty state before the first fetch resolves on a route that didn't
   * pre-populate the atoms.
   */
  loading: boolean;
  collapsed: ReadonlySet<string>;
  selectedId?: string;
  renamingId?: string;
  dragId?: string;
  drop?: { id: string; position: FolioDropPosition };
  /**
   * Set while an EXTERNAL file drag (`dataTransfer` carrying `Files`) is over
   * the tree, naming the directory the bytes would land in — `parentId:
   * undefined` is the project root. Kept separate from `drop` above because
   * the two answer different questions: `drop` is a re-parent of a row that
   * already exists and has three positions per row, this is a create with
   * exactly one. Sharing the field would make `dragId` (never set for an
   * external drag) the only thing telling them apart.
   */
  fileDrop?: { parentId?: string };
  toggle: (id: string) => void;
  select: (node: FolioTreeNode) => void;
  beginRename: (id: string) => void;
  commitRename: (id: string, name: string) => Promise<void>;
  cancelRename: () => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, position: FolioDropPosition) => void;
  onDrop: (id: string) => Promise<void>;
  onDragEnd: () => void;
  /** An external file drag is hovering the row/area that owns `parentId`. */
  onFileDragOver: (parentId?: string) => void;
  /** The file drag left the tree entirely — clear the highlight. */
  onFileDragLeave: () => void;
  /** Upload the dropped files into `parentId` (or the project root). */
  dropFiles: (files: File[], parentId?: string) => Promise<void>;
  createFolio: (parentId?: string) => Promise<void>;
  createDirectory: (parentId?: string) => Promise<void>;
  /** Pick files and upload them into `parentId` (or the project root). */
  uploadBlobs: (parentId?: string) => Promise<void>;
  remove: (node: FolioTreeNode) => Promise<void>;
  duplicate: (node: FolioTreeNode) => Promise<void>;
  togglePin: (node: FolioTreeNode) => Promise<void>;
}

/**
 * Owns the folio tree pane's data + interaction state: the tree built from
 * `userFoliosAtom` + `projectDirectoriesAtom` (Task 3's `buildFolioTree`),
 * collapse/selection/rename/drag state, and every mutation the tree can
 * trigger (create, rename, move via drag, delete, duplicate, pin).
 *
 * ## This hook must NOT be mounted inside the folio-keyed subtree
 *
 * `FolioWorkspace` remounts `FolioWorkspaceContent` on a `key` tied to the
 * folio id specifically so a folio-to-folio navigation resets the draft
 * buffer, `useForm`, etc. (see that file's doc). This hook is the opposite:
 * its collapse state and the one-time-seed guard below only work if THIS
 * hook survives a folio switch — the seed must run once per TREE mount, not
 * once per FOLIO mount. `FolioTree` (and therefore this hook) is mounted
 * from `FolioWorkspace` itself, outside the keyed subtree, for exactly this
 * reason. The deleted `FolioTreePanel.tsx` got this "for free" because it
 * was rendered by the old `FolioView.tsx`, itself never remounted across
 * folio navigations (Alepha's router doesn't remount on a param-only nav —
 * see `FolioWorkspace.tsx`'s doc). Mounting this hook from
 * `FolioWorkspaceContent` instead would silently reintroduce feedback #14:
 * every navigation would look like a fresh mount, `initializedRef` would
 * reset, and the seed would re-collapse whatever the user had left open.
 *
 * ## Why this hook has its own `useQuery`
 *
 * `projectFoliosFolio`'s and `projectFolios`'s route loaders both
 * pre-populate `userFoliosAtom` + `projectDirectoriesAtom`, so most of the
 * time this hook renders straight from cache with no fetch of its own.
 * `projectFoliosNew`'s loader is the gap: it only fills
 * `projectDirectoriesAtom` (for the meta bar's create-mode directory chip),
 * never `userFoliosAtom` — landing directly on `/folios/new` (a fresh tab,
 * a bookmark, a reload) leaves the folio list at whatever `userFoliosAtom`
 * last held, which can be its `[]` default. The fallback query below,
 * keyed `["folioTree", projectId]` (the same key every mutation in this
 * file and in `useFolioActions.ts` already invalidates), only runs while
 * neither atom has data — ported from the deleted `FolioTreePanel.tsx`'s
 * identical `enabled: !seeded` guard.
 *
 * ## The repair-write vs. no-op distinction
 *
 * `buildFolioTree` breaks a `parentId` cycle by promoting one member to the
 * tree's root, so that directory *displays* at root while the database
 * still records its cyclic parent (`FolioTreeNode.declaredParentId` carries
 * the true stored value on exactly those nodes). `resolveFolioDrop`
 * accounts for this: dragging such a node to root resolves to
 * `{ parentId: undefined }` — a real, necessary write that clears the
 * corruption — even though the node is ALREADY rendered at root and
 * nothing visibly moves. `onDrop` below always issues the move whenever
 * `resolveFolioDrop` returns a target, and NEVER infers "nothing to do"
 * from whether the drop's `targetId` sits at the same visual position as
 * `dragId` — the return value is the only signal trusted. Both an ordinary
 * move and this repair are treated identically (no toast either way): an
 * ordinary move's own re-render is its feedback, and the brief's own text
 * calls quieter treatment for the invisible repair a defensible choice —
 * showing a toast for only the invisible case would require branching on
 * "was this actually a repair", which needs no code here since the write
 * either fires or it doesn't, and the tree already reflects whichever is
 * true after it resolves.
 */
export const useFolioTreeModel = (
  input: UseFolioTreeModelInput,
): FolioTreeState => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const dialog = useDialog();
  const folioApi = useClient<FolioController>();
  const directoryApi = useClient<DirectoryController>();
  const blobApi = useClient<BlobController>();

  const [folios, setFolios] = useStore(userFoliosAtom);
  const [directories, setDirectories] = useStore(projectDirectoriesAtom);
  const [blobs, setBlobs] = useStore(projectBlobsAtom);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Seeded from `pendingFolioTreeRenameAtom` — see that atom's doc for why
  // `createFolio`'s own `setRenamingId` call (below) is not enough on its
  // own: the navigation it triggers can remount this whole hook before that
  // state ever paints.
  const [renamingId, setRenamingId] = useState<string | undefined>(() =>
    alepha.store.get(pendingFolioTreeRenameAtom),
  );
  useEffect(() => {
    if (alepha.store.get(pendingFolioTreeRenameAtom) !== undefined) {
      alepha.store.set(pendingFolioTreeRenameAtom, undefined);
    }
    // Runs once per mount, deliberately — clears the hand-off exactly once
    // so it never leaks into a later, unrelated mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dragId, setDragId] = useState<string | undefined>();
  const [drop, setDrop] = useState<
    { id: string; position: FolioDropPosition } | undefined
  >();
  const [fileDrop, setFileDrop] = useState<{ parentId?: string } | undefined>();
  // Guards the one-time default-collapse below — see the file doc.
  const initializedRef = useRef(false);

  const seeded = folios.length > 0 || directories.length > 0;

  const { loading: fetching } = useQuery(
    {
      key: ["folioTree", input.projectId],
      enabled: !seeded,
      staleTime: [30, "seconds"],
      handler: async () => {
        const [folioList, dirList] = await Promise.all([
          folioApi.list({ query: { projectId: input.projectId, limit: 100 } }),
          directoryApi.listAllDirectories({
            params: { projectId: input.projectId },
          }),
        ]);
        return { folios: folioList, directories: dirList };
      },
      onSuccess: (result) => {
        setFolios(result.folios);
        setDirectories(result.directories);
      },
      onError: () => {},
    },
    [input.projectId, folioApi, directoryApi],
  );

  const tree = useMemo(
    () =>
      buildFolioTree({
        directories,
        folios: folios.map((f) => ({
          id: f.id,
          title: f.title,
          shortId: f.shortId,
          directoryId: f.directoryId,
          pinned: f.pinned,
          protected: f.protected,
        })),
        blobs,
      }),
    [directories, folios, blobs],
  );

  const rows = useMemo(
    () => flattenFolioTree(tree, collapsed),
    [tree, collapsed],
  );

  // Full id → node map, independent of collapse state (rows only include
  // VISIBLE nodes). Used for ancestor walks and rename/drop lookups.
  const nodeById = useMemo(() => {
    const map = new Map<string, FolioTreeNode>();
    const walk = (nodes: FolioTreeNode[]): void => {
      for (const node of nodes) {
        map.set(node.id, node);
        if (node.children) walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  // Ancestor chain (directory ids) of the currently open folio, walked
  // through the CYCLE-RESOLVED tree (`node.parentId`, not the raw
  // `directories` list) — a directory whose declared parent was rewritten
  // by cycle-breaking must be walked at its DISPLAYED position, or this
  // could loop on the very corruption `buildFolioTree` already resolved.
  const ancestorDirIds = useMemo(() => {
    const ancestors = new Set<string>();
    if (!input.currentFolioId) return ancestors;
    let cursor = nodeById.get(input.currentFolioId)?.parentId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      ancestors.add(cursor);
      cursor = nodeById.get(cursor)?.parentId;
    }
    return ancestors;
  }, [nodeById, input.currentFolioId]);

  // One-time seed: collapse every directory except the current folio's
  // ancestor chain. Ported from `FolioTreePanel.tsx` — without the
  // `initializedRef` guard this re-ran on every folio→folio navigation and
  // re-collapsed whatever the user had opened (feedback #14).
  useEffect(() => {
    if (initializedRef.current) return;
    if (directories.length === 0 && folios.length === 0) return; // await data
    initializedRef.current = true;
    const defaultCollapsed = new Set<string>();
    for (const d of directories) {
      if (!ancestorDirIds.has(d.id)) defaultCollapsed.add(d.id);
    }
    setCollapsed(defaultCollapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ancestorDirIds, directories, folios]);

  // Later navigations only ever EXPAND the new folio's ancestor path —
  // never collapse anything else. This is what keeps a directory open when
  // jumping from one of its folios to an unrelated root-level folio.
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

  const toggle = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Expand exactly the given directory (not its ancestors) — used after
   * creating a folio/directory inside it. The parent's own row can only
   * have been right-clicked (the create action's origin) while visible,
   * which means its ancestors are already expanded; only the parent itself
   * might be collapsed.
   */
  const expandOne = (id?: string): void => {
    if (!id) return;
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const select = (node: FolioTreeNode): void => {
    if (node.kind === "directory") {
      toggle(node.id);
      return;
    }
    // A blob has no page of its own — it is bytes. The framework's file route
    // serves them with the right content type, so the browser decides: an
    // image renders, everything else downloads. Opening in a new tab rather
    // than navigating keeps the workspace (and any unsaved draft) where it is.
    if (node.kind === "blob") {
      window.open(`/api/files/${node.id}`, "_blank", "noopener");
      return;
    }
    router.push(
      router.path("projectFoliosFolio", {
        params: { projectSlug: input.projectSlug, shortId: node.shortId },
      }),
    );
  };

  const renameAction = useAction<[string, string], void>(
    {
      handler: async (id: string, name: string) => {
        const node = nodeById.get(id);
        if (!node) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === node.name) return;
        if (node.kind === "directory") {
          const updated = await directoryApi.renameDirectory({
            params: { id },
            body: { name: trimmed },
          });
          setDirectories(
            directories.map((d) =>
              d.id === id ? { ...d, name: updated.name } : d,
            ),
          );
        } else if (node.kind === "blob") {
          // Its own endpoint and its own atom: routing a blob through
          // `folioApi.update` would address a folio that does not exist.
          const updated = await blobApi.renameBlob({
            params: { id },
            body: { name: trimmed },
          });
          setBlobs(
            blobs.map((b) =>
              b.fileId === id ? { ...b, name: updated.name } : b,
            ),
          );
        } else {
          const updated = await folioApi.update({
            params: { id },
            body: { title: trimmed },
          });
          setFolios(
            folios.map((f) => (f.id === id ? { ...f, ...updated } : f)),
          );
        }
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [
      nodeById,
      directories,
      setDirectories,
      folios,
      setFolios,
      blobs,
      setBlobs,
      directoryApi,
      folioApi,
      blobApi,
      input.projectId,
    ],
  );

  const commitRename = async (id: string, name: string): Promise<void> => {
    await renameAction.run(id, name);
    setRenamingId(undefined);
  };

  const moveFolioAction = useAction<[string, string | undefined], void>(
    {
      handler: async (id: string, parentId: string | undefined) => {
        // Asymmetry 1: a folio moving to the project root needs an
        // EXPLICIT `directoryId: null` — `undefined` is dropped by the ORM
        // update layer (`"directoryId" in body"` reads false) and the
        // folio silently stays where it was. `parentId ?? null` is the fix.
        const updated = await folioApi.update({
          params: { id },
          body: { directoryId: parentId ?? null },
        });
        setFolios(folios.map((f) => (f.id === id ? { ...f, ...updated } : f)));
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [folios, setFolios, folioApi, input.projectId],
  );

  const moveDirectoryAction = useAction<[string, string | undefined], void>(
    {
      handler: async (id: string, parentId: string | undefined) => {
        // Asymmetry 2: a directory moving to the project root sends
        // `parentId: undefined` (omitted) — `moveDirectory`'s body schema
        // has no nullable variant, unlike the folio endpoint above. No
        // `?? null` here: passing `undefined` straight through is correct
        // for THIS endpoint, wrong for the folio one above.
        const updated = await directoryApi.moveDirectory({
          params: { id },
          body: { parentId },
        });
        // `move()` re-runs the sibling-name reservation at the new parent,
        // so the response's `name` can differ from the pre-move name on a
        // collision — mirror both fields, not just `parentId`.
        setDirectories(
          directories.map((d) =>
            d.id === id
              ? { ...d, parentId: updated.parentId, name: updated.name }
              : d,
          ),
        );
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [directories, setDirectories, directoryApi, input.projectId],
  );

  const onDragStart = (id: string): void => setDragId(id);

  const onDragOver = (id: string, position: FolioDropPosition): void => {
    setDrop({ id, position });
  };

  const onDragEnd = (): void => {
    setDragId(undefined);
    setDrop(undefined);
  };

  const onDrop = async (targetId: string): Promise<void> => {
    const currentDragId = dragId;
    // Trust `targetId` (the row whose own `onDrop` fired) paired with
    // `drop` ONLY when it agrees on which row that is — guards against a
    // stale `drop` from a row the pointer passed over earlier if the
    // browser's dragover/drop ordering ever disagrees.
    const position = drop && drop.id === targetId ? drop.position : undefined;
    setDragId(undefined);
    setDrop(undefined);
    if (!currentDragId || !position) return;

    const target = resolveFolioDrop(tree, currentDragId, targetId, position);
    // `undefined` covers BOTH an illegal drop (into your own subtree) AND
    // a true no-op (already at that parent) — see `resolveFolioDrop`'s own
    // doc. Either way, nothing to write.
    if (!target) return;

    const dragged = findFolioNode(tree, currentDragId);
    if (!dragged) return;

    if (dragged.kind === "directory") {
      await moveDirectoryAction.run(currentDragId, target.parentId);
    } else {
      await moveFolioAction.run(currentDragId, target.parentId);
    }
  };

  const createFolioAction = useAction<[string | undefined], void>(
    {
      handler: async (parentId?: string) => {
        const created = await folioApi.create({
          body: {
            projectId: input.projectId,
            title: String(tr("folios.editor.tree.untitled-folio")),
            directoryId: parentId,
          },
        });
        setFolios([created, ...folios]);
        expandOne(parentId);
        setRenamingId(created.id);
        // Belt-and-suspenders with the `setRenamingId` above: see
        // `pendingFolioTreeRenameAtom`'s doc for why the local state alone
        // is not reliable across the navigation on the next line.
        alepha.store.set(pendingFolioTreeRenameAtom, created.id);
        await router.push(
          router.path("projectFoliosFolio", {
            params: {
              projectSlug: input.projectSlug,
              shortId: created.shortId,
            },
          }),
        );
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [
      folios,
      setFolios,
      folioApi,
      alepha,
      input.projectId,
      input.projectSlug,
      router,
      tr,
    ],
  );

  const createFolio = async (parentId?: string): Promise<void> => {
    await createFolioAction.run(parentId);
  };

  /**
   * Upload files into a directory (or the project root).
   *
   * Reuses the same two-step flow as the markdown editor's image button —
   * framework file bytes, then the blob registration that gives them a place
   * in this project's tree — rather than a second upload path that would
   * drift from it.
   */
  const uploadBlobsAction = useAction<[File[], string | undefined], void>(
    {
      handler: async (files: File[], parentId?: string) => {
        const created: typeof blobs = [];
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          const uploaded = await fetch(
            `/api/files?bucket=${encodeURIComponent(FOLIO_BLOB_BUCKET)}`,
            { method: "POST", body: form, credentials: "include" },
          );
          if (!uploaded.ok) {
            throw new AlephaError(
              `Upload of "${file.name}" failed (${uploaded.status})`,
            );
          }
          const { id } = (await uploaded.json()) as { id: string };
          const row = await blobApi.registerBlob({
            params: { projectId: input.projectId },
            body: { fileId: id, name: file.name, directoryId: parentId },
          });
          created.push({
            fileId: row.fileId,
            shortId: row.shortId,
            name: row.name,
            directoryId: row.directoryId,
            updatedAt: row.updatedAt,
          });
        }
        setBlobs([...blobs, ...created]);
        if (parentId) expandOne(parentId);
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [blobs, setBlobs, blobApi, input.projectId],
  );

  /**
   * Run the upload and surface any failure through `useDialog`, never
   * `window.alert` — the deleted `FolioBrowser` used `alert` here and the
   * project bans it. Shared by the picker below and the file-drop path so a
   * failed drop reports exactly like a failed pick.
   */
  const runUpload = async (files: File[], parentId?: string): Promise<void> => {
    try {
      await uploadBlobsAction.run(files, parentId);
    } catch (error) {
      await dialog.alert({
        title: tr("folios.editor.tree.upload-failed"),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onFileDragOver = (parentId?: string): void => {
    // Compare before setting: `dragover` fires continuously while the pointer
    // sits still, and a fresh object literal every time would re-render the
    // whole tree at the browser's dragover cadence.
    setFileDrop((prev) =>
      prev && prev.parentId === parentId ? prev : { parentId },
    );
  };

  const onFileDragLeave = (): void => setFileDrop(undefined);

  const dropFiles = async (files: File[], parentId?: string): Promise<void> => {
    setFileDrop(undefined);
    if (files.length === 0) return;
    await runUpload(files, parentId);
  };

  /**
   * Ask for files and upload them.
   */
  const uploadBlobs = async (parentId?: string): Promise<void> => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.style.display = "none";
    document.body.appendChild(picker);
    const files = await new Promise<File[]>((resolve) => {
      picker.onchange = () => resolve([...(picker.files ?? [])]);
      // `cancel` fires on dismissal in every browser that supports the file
      // picker's own cancel event; without it the promise would never settle
      // and the node would leak.
      picker.oncancel = () => resolve([]);
      picker.click();
    });
    picker.remove();
    if (files.length === 0) return;
    await runUpload(files, parentId);
  };

  const createDirectoryAction = useAction<[string | undefined], void>(
    {
      handler: async (parentId?: string) => {
        const created = await directoryApi.createDirectory({
          params: { projectId: input.projectId },
          body: {
            name: String(tr("folios.editor.tree.untitled-directory")),
            parentId,
          },
        });
        setDirectories([...directories, created]);
        expandOne(parentId);
        setRenamingId(created.id);
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [directories, setDirectories, directoryApi, input.projectId, tr],
  );

  const createDirectory = async (parentId?: string): Promise<void> => {
    await createDirectoryAction.run(parentId);
  };

  const deleteFolioAction = useAction<[string], void>(
    {
      handler: async (id: string) => {
        await folioApi.delete({ params: { id } });
        setFolios(folios.filter((f) => f.id !== id));
        if (input.currentFolioId === id) {
          await router.push(
            router.path("projectFolios", {
              params: { projectSlug: input.projectSlug },
            }),
          );
        }
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [
      folios,
      setFolios,
      folioApi,
      input.currentFolioId,
      input.projectId,
      input.projectSlug,
      router,
    ],
  );

  const deleteDirectoryAction = useAction<
    [string, Set<string>, Set<string>],
    void
  >(
    {
      handler: async (
        id: string,
        removedDirIds: Set<string>,
        removedFolioIds: Set<string>,
      ) => {
        await directoryApi.deleteDirectory({
          params: { id },
          query: { cascade: true },
        });
        setDirectories(directories.filter((d) => !removedDirIds.has(d.id)));
        setFolios(folios.filter((f) => !removedFolioIds.has(f.id)));
        if (input.currentFolioId && removedFolioIds.has(input.currentFolioId)) {
          await router.push(
            router.path("projectFolios", {
              params: { projectSlug: input.projectSlug },
            }),
          );
        }
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [
      directories,
      setDirectories,
      folios,
      setFolios,
      directoryApi,
      input.currentFolioId,
      input.projectId,
      input.projectSlug,
      router,
    ],
  );

  const deleteBlobAction = useAction<[string], void>(
    {
      handler: async (id: string) => {
        await blobApi.deleteBlob({ params: { id } });
        setBlobs(blobs.filter((b) => b.fileId !== id));
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [blobs, setBlobs, blobApi, input.projectId],
  );

  const remove = async (node: FolioTreeNode): Promise<void> => {
    if (node.kind === "directory") {
      const confirmed = await dialog.confirm({
        title: tr("folios.editor.tree.confirm-delete-directory-title"),
        description: tr("folios.editor.tree.confirm-delete-directory-body"),
        destructive: true,
      });
      if (!confirmed) return;
      // Deleting a directory is CASCADE — the server wipes every folio
      // inside it. Collect the whole subtree from the tree we already have
      // (built moments ago) so the atoms are cleared of the same scope the
      // server just deleted, rather than leaving orphaned rows visible
      // until the next `["folioTree", projectId]` refetch lands.
      const removedDirIds = new Set<string>();
      const removedFolioIds = new Set<string>();
      const collect = (n: FolioTreeNode): void => {
        if (n.kind === "directory") removedDirIds.add(n.id);
        else removedFolioIds.add(n.id);
        for (const child of n.children ?? []) collect(child);
      };
      collect(node);
      await deleteDirectoryAction.run(node.id, removedDirIds, removedFolioIds);
    } else {
      const confirmed = await dialog.confirm({
        title: tr("folios.confirm-delete-title"),
        description: tr("folios.confirm-delete-message"),
        destructive: true,
      });
      if (!confirmed) return;
      if (node.kind === "blob") {
        await deleteBlobAction.run(node.id);
        return;
      }
      await deleteFolioAction.run(node.id);
    }
  };

  const duplicateAction = useAction<[FolioTreeNode], void>(
    {
      handler: async (node: FolioTreeNode) => {
        if (node.kind === "directory") return;
        // The source's `content` is copied AS-IS, whether plaintext or a
        // protected envelope — a passphrase-encrypted envelope is opaque
        // JSON the server never interprets, so duplicating it byte-for-byte
        // reproduces a folio that decrypts identically with the SAME
        // passphrase, with no need to decrypt (or even for this folio to
        // be unlocked) to make the copy.
        const source = await folioApi.get({ params: { id: node.id } });
        const created = await folioApi.create({
          body: {
            projectId: input.projectId,
            title: `${source.title}${tr("folio.action.duplicate-suffix")}`,
            content: source.content,
            tags: source.tags,
            summary: source.summary,
            protected: source.protected,
            directoryId: source.directoryId,
          },
        });
        setFolios([created, ...folios]);
        await router.push(
          router.path("projectFoliosFolio", {
            params: {
              projectSlug: input.projectSlug,
              shortId: created.shortId,
            },
          }),
        );
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [
      folios,
      setFolios,
      folioApi,
      input.projectId,
      input.projectSlug,
      router,
      tr,
    ],
  );

  const duplicate = async (node: FolioTreeNode): Promise<void> => {
    await duplicateAction.run(node);
  };

  const pinAction = useAction<[FolioTreeNode], void>(
    {
      handler: async (node: FolioTreeNode) => {
        if (node.kind === "directory") return;
        const updated = await folioApi.update({
          params: { id: node.id },
          body: { pinned: !node.pinned },
        });
        setFolios(
          folios.map((f) => (f.id === node.id ? { ...f, ...updated } : f)),
        );
      },
      invalidates: [["folioTree", input.projectId]],
    },
    [folios, setFolios, folioApi, input.projectId],
  );

  const togglePin = async (node: FolioTreeNode): Promise<void> => {
    await pinAction.run(node);
  };

  return {
    rows,
    loading: fetching,
    collapsed,
    selectedId: input.currentFolioId,
    renamingId,
    dragId,
    drop,
    fileDrop,
    toggle,
    select,
    beginRename: (id: string) => setRenamingId(id),
    commitRename,
    cancelRename: () => setRenamingId(undefined),
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onFileDragOver,
    onFileDragLeave,
    dropFiles,
    createFolio,
    createDirectory,
    uploadBlobs,
    remove,
    duplicate,
    togglePin,
  };
};
