import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
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

import type { DirectoryController } from "@/api/controllers/DirectoryController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";

import type { AppRouter } from "../../../../AppRouter.ts";
import { pendingFolioTreeRenameAtom } from "../../../../atoms/pendingFolioTreeRenameAtom.ts";
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

export interface UseFolioTreeModelInput {
  projectId: number;
  projectSlug: string;
  /**
   * The folio open in the document pane, if any. Drives both the
   * highlighted row (`selectedId`) and the ancestor-expansion behavior on
   * navigation — see the file doc below.
   */
  currentFolioId?: string;
  /**
   * A directory to reveal, by per-project shortId - `/folios?dir=<n>`.
   *
   * The breadcrumb and the tree's own Open / Open in new tab both build
   * that link, and it went nowhere: the route never read the parameter, so
   * both landed on the workspace's default state. Revealing means the
   * directory AND its ancestors expand, and its row is the selected one
   * when no folio is open.
   *
   * A shortId rather than a UUID because that is what the URL carries and
   * this hook already holds the directory list to resolve it against - a
   * loader round-trip would buy nothing.
   */
  revealDirectoryShortId?: number;
}

/**
 * Everything the tree can DO, separated from everything it currently IS.
 *
 * The split exists so `FolioTreeRow` can be `memo`ised. Every command here
 * closes over `folios` / `directories` / `tree`, so their implementations
 * change identity on every render; the object a row receives must not, or
 * the memo can never hold. See `commands` in the hook for how both are true
 * at once.
 */
export interface FolioTreeCommands {
  toggle: (id: string) => void;
  select: (node: FolioTreeNode) => void;
  beginRename: (id: string) => void;
  commitRename: (id: string, name: string) => Promise<void>;
  cancelRename: () => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, position: FolioDropPosition) => void;
  onDrop: (id: string) => Promise<void>;
  onDragEnd: () => void;
  createFolio: (parentId?: string) => Promise<void>;
  createDirectory: (parentId?: string) => Promise<void>;
  remove: (node: FolioTreeNode) => Promise<void>;
  duplicate: (node: FolioTreeNode) => Promise<void>;
  togglePin: (node: FolioTreeNode) => Promise<void>;
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
   * Stable for the life of the hook. A row may hold onto it across any
   * number of renders without going stale.
   */
  commands: FolioTreeCommands;
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

  const [folios, setFolios] = useStore(userFoliosAtom);
  const [directories, setDirectories] = useStore(projectDirectoriesAtom);

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
  }, []);
  const [dragId, setDragId] = useState<string | undefined>();
  const [drop, setDrop] = useState<
    { id: string; position: FolioDropPosition } | undefined
  >();
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
      }),
    [directories, folios],
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

  /**
   * The `?dir=<shortId>` directory, as a node id. Resolved here rather than
   * in the route loader: this hook already holds the whole directory list,
   * so the lookup is local and the URL stays the only carrier.
   */
  const revealedDirectoryId = useMemo(() => {
    if (input.revealDirectoryShortId === undefined) return undefined;
    return directories.find((d) => d.shortId === input.revealDirectoryShortId)
      ?.id;
  }, [directories, input.revealDirectoryShortId]);

  /**
   * Everything that must be open: the current folio's ancestors, plus the
   * revealed directory and its own ancestors - the directory ITSELF too,
   * since "open this directory" means seeing what is in it.
   */
  const expandDirIds = useMemo(() => {
    if (!revealedDirectoryId) return ancestorDirIds;
    const ids = new Set(ancestorDirIds);
    let cursor: string | undefined = revealedDirectoryId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      ids.add(cursor);
      cursor = nodeById.get(cursor)?.parentId;
    }
    return ids;
  }, [ancestorDirIds, nodeById, revealedDirectoryId]);

  // One-time seed: collapse every directory except the ones that must be
  // open. Ported from `FolioTreePanel.tsx` - without the `initializedRef`
  // guard this re-ran on every folio→folio navigation and re-collapsed
  // whatever the user had opened (feedback #14).
  useEffect(() => {
    if (initializedRef.current) return;
    if (directories.length === 0 && folios.length === 0) return; // await data
    initializedRef.current = true;
    const defaultCollapsed = new Set<string>();
    for (const d of directories) {
      if (!expandDirIds.has(d.id)) defaultCollapsed.add(d.id);
    }
    // One-time initialisation, guarded by `initializedRef` above, so it cannot
    // cascade.
    // oxlint-disable-next-line react/set-state-in-effect
    setCollapsed(defaultCollapsed);
  }, [expandDirIds, directories, folios]);

  // Later navigations only ever EXPAND the new target's path - never
  // collapse anything else. This is what keeps a directory open when
  // jumping from one of its folios to an unrelated root-level folio, and
  // what makes a `?dir=` link work when the workspace is already mounted.
  useEffect(() => {
    if (!initializedRef.current) return;
    if (expandDirIds.size === 0) return;
    // One-time initialisation, guarded by `initializedRef` above, so it cannot
    // cascade.
    // oxlint-disable-next-line react/set-state-in-effect
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of expandDirIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [expandDirIds]);

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
    void router.push(
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
      directoryApi,
      folioApi,
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

  /**
   * The current implementation of every command, rebuilt on each render
   * because each one closes over `folios`, `directories`, `tree` or
   * `dragId`. Assigned during render, the same way `FolioTree` already
   * keeps its published actions current.
   */
  const implRef = useRef<FolioTreeCommands>(undefined as never);
  implRef.current = {
    toggle,
    select,
    beginRename: (id: string) => setRenamingId(id),
    commitRename,
    cancelRename: () => setRenamingId(undefined),
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    createFolio,
    createDirectory,
    remove,
    duplicate,
    togglePin,
  };

  /**
   * The same commands behind a facade whose identity NEVER changes.
   *
   * This is what makes `memo(FolioTreeRow)` worth anything. Before it, one
   * toggle re-rendered every visible row: `rows` is memoised, but each row
   * received the whole state object, and that object was rebuilt on every
   * render along with all fourteen of its callbacks.
   *
   * A facade rather than `useCallback` on each command, because most of
   * them legitimately change when the data changes - `commitRename` closes
   * over `folios` - and a row holding last render's copy would write a
   * stale list back. Reading through the ref means a row can hold this
   * object forever and still call the current implementation.
   */
  const commands = useMemo<FolioTreeCommands>(
    () => ({
      toggle: (id) => implRef.current.toggle(id),
      select: (node) => implRef.current.select(node),
      beginRename: (id) => implRef.current.beginRename(id),
      commitRename: (id, name) => implRef.current.commitRename(id, name),
      cancelRename: () => implRef.current.cancelRename(),
      onDragStart: (id) => implRef.current.onDragStart(id),
      onDragOver: (id, position) => implRef.current.onDragOver(id, position),
      onDrop: (id) => implRef.current.onDrop(id),
      onDragEnd: () => implRef.current.onDragEnd(),
      createFolio: (parentId) => implRef.current.createFolio(parentId),
      createDirectory: (parentId) => implRef.current.createDirectory(parentId),
      remove: (node) => implRef.current.remove(node),
      duplicate: (node) => implRef.current.duplicate(node),
      togglePin: (node) => implRef.current.togglePin(node),
    }),
    [],
  );

  return {
    rows,
    loading: fetching,
    collapsed,
    // The open folio wins: a `?dir=` that survives into a folio navigation
    // must not keep highlighting the folder instead of the document.
    selectedId: input.currentFolioId ?? revealedDirectoryId,
    renamingId,
    dragId,
    drop,
    commands,
  };
};
