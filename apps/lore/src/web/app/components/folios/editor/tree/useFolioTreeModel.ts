import {
  type TreeDropPosition,
  resolveDrop,
} from "@alepha/ui/components/tree-view/tree-model.ts";
import {
  type TreeStateCommands,
  useTreeState,
} from "@alepha/ui/components/tree-view/use-tree-state.ts";
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
import { useEffect, useMemo, useRef } from "react";

import type { DirectoryController } from "@/api/controllers/DirectoryController.ts";
import type { FolioController } from "@/api/controllers/FolioController.ts";

import type { AppRouter } from "../../../../AppRouter.ts";
import { folioTreeCollapsedAtom } from "../../../../atoms/folioTreeCollapsedAtom.ts";
import { pendingFolioTreeRenameAtom } from "../../../../atoms/pendingFolioTreeRenameAtom.ts";
import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import {
  buildFolioTree,
  type FolioTreeNode,
  type FolioTreeRow,
  findFolioNode,
  flattenFolioTree,
} from "./folioTree.ts";

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
 * Lore's own verbs: what this tree can do that a tree in general cannot.
 *
 * The split from `TreeStateCommands` is where the epic #E40 line falls.
 * Everything here closes over `folios` / `directories` / `tree`, so their
 * implementations change identity on every render; the object handed
 * downwards must not, or `TreeViewRow`'s memo can never hold. See `commands`
 * in the hook for how both are true at once.
 */
export interface FolioTreeVerbs {
  select: (node: FolioTreeNode) => void;
  createFolio: (parentId?: string) => Promise<void>;
  createDirectory: (parentId?: string) => Promise<void>;
  remove: (node: FolioTreeNode) => Promise<void>;
  duplicate: (node: FolioTreeNode) => Promise<void>;
  togglePin: (node: FolioTreeNode) => Promise<void>;
}

/**
 * `useTreeState`'s generic commands (toggle, rename, the drag gesture) plus
 * Lore's own verbs, as one object, because `FolioTreeContextMenu` reaches for
 * both halves from the same place.
 */
export interface FolioTreeCommands extends TreeStateCommands, FolioTreeVerbs {}

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
  drop?: { id: string; position: TreeDropPosition };
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
 * ## Collapse state is NOT this hook's to hold
 *
 * It lives in `folioTreeCollapsedAtom`, and the reason is that this hook IS
 * remounted, on a path nobody expected. `FoliosLayout` renders
 * `{name === "projectFolios" ? <FolioWorkspace empty /> : <NestedView />}`,
 * two different component types in two different positions, so walking from
 * the folio list to a folio tears the whole workspace down and builds it
 * again. The old `initializedRef` guard survived re-renders but not that, so
 * the one-time seed ran a second time and re-collapsed every directory except
 * the opened folio's ancestors - feedback #14, returning as #2100 through a
 * door its guard could not see.
 *
 * The atom survives a remount by construction, and carries its `projectId`
 * so the seed runs once per PROJECT rather than once per mount, which is what
 * "one-time" was always trying to mean.
 *
 * ⚠️ The placement below still matters for everything else. `FolioWorkspace`
 * remounts `FolioWorkspaceContent` on a `key` tied to the folio id, so a
 * folio-to-folio navigation resets the draft buffer and `useForm` (see that
 * file's doc). `FolioTree` is mounted from `FolioWorkspace` itself, OUTSIDE
 * that keyed subtree, so `renamingId`, `dragId` and the rest are not thrown
 * away every time the reader opens another folio. Moving it inside would
 * still be wrong.
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
 * the true stored value on exactly those nodes). `resolveDrop`
 * accounts for this: dragging such a node to root resolves to
 * `{ parentId: undefined }` — a real, necessary write that clears the
 * corruption — even though the node is ALREADY rendered at root and
 * nothing visibly moves. `onDrop` below always issues the move whenever
 * `resolveDrop` returns a target, and NEVER infers "nothing to do"
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

  /**
   * ⚠️ Collapse state lives in an ATOM, not here.
   *
   * See `folioTreeCollapsedAtom`: `FoliosLayout` swaps component types
   * between `/folios` and `/folios/:shortId`, so this hook is remounted on
   * that navigation and any ref-guarded local state starts over. That is how
   * feedback #14 came back as #2100.
   *
   * `projectId` carried alongside is what replaces `initializedRef`: a set
   * stored for THIS project means the seed has run, and one stored for
   * another project means it has not.
   */
  const [collapsedState, setCollapsedState] = useStore(folioTreeCollapsedAtom);
  const seededForProject = collapsedState?.projectId === input.projectId;
  const collapsed = useMemo(
    () => new Set(seededForProject ? collapsedState.collapsed : []),
    [collapsedState, seededForProject],
  );
  const writeCollapsed = (next: ReadonlySet<string>): void => {
    setCollapsedState({
      projectId: input.projectId,
      collapsed: [...next],
    });
  };
  /**
   * Collapse, rename and the drag gesture come from `@alepha/ui`'s
   * `useTreeState`. Everything below this line is what makes the tree a
   * FOLIO tree: the two controllers, the eight actions, the confirmations,
   * the routing, the per-project seed and the reveal effect.
   *
   * ⚠️ `collapsed` is handed in as a controlled pair backed by an atom, and
   * that is the whole reason the state survives `FoliosLayout`'s remount.
   * See the block above, and `useTreeState`'s own doc.
   *
   * `initialRenamingId` is seeded from `pendingFolioTreeRenameAtom` for the
   * reason that atom exists: `createFolio`'s own `beginRename` is not enough
   * on its own, because the navigation it triggers can remount this whole
   * hook before that state ever paints.
   */
  const state = useTreeState({
    collapsed: [collapsed, writeCollapsed],
    initialRenamingId: alepha.store.get(pendingFolioTreeRenameAtom),
    onRename: (id, name) => renameActionRef.current(id, name),
    onMove: (dragId, targetId, position) =>
      moveRef.current(dragId, targetId, position),
  });
  const { renamingId, dragId, drop } = state;

  useEffect(() => {
    if (alepha.store.get(pendingFolioTreeRenameAtom) !== undefined) {
      alepha.store.set(pendingFolioTreeRenameAtom, undefined);
    }
    // Runs once per mount, deliberately — clears the hand-off exactly once
    // so it never leaks into a later, unrelated mount.
  }, []);

  /**
   * `useTreeState` is called before the actions it needs exist, so the two
   * callbacks it takes read through refs assigned further down. Not a
   * layering trick: the actions close over `folios` / `directories` /
   * `tree`, all of which are derived from state this hook owns, and hoisting
   * them above the hook would mean hoisting the whole file.
   */
  const renameActionRef = useRef<(id: string, name: string) => Promise<void>>(
    undefined as never,
  );
  const moveRef = useRef<
    (dragId: string, targetId: string, position: TreeDropPosition) => void
  >(undefined as never);

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

  // Seed, once per PROJECT: collapse every directory except the ones that
  // must be open. `seededForProject` replaces the old `initializedRef` - a
  // ref survives re-renders but not the remount `FoliosLayout` causes between
  // `/folios` and `/folios/:shortId`, which is what re-collapsed the tree
  // under the reader (feedback #14, then #2100).
  useEffect(() => {
    if (seededForProject) return;
    if (directories.length === 0 && folios.length === 0) return; // await data
    const defaultCollapsed = new Set<string>();
    for (const d of directories) {
      if (!expandDirIds.has(d.id)) defaultCollapsed.add(d.id);
    }
    // Runs once per project, guarded by `seededForProject`. No
    // `set-state-in-effect` suppression needed any more: this writes an atom
    // rather than component state, which is the other half of why the move
    // was worth making.
    writeCollapsed(defaultCollapsed);
  }, [seededForProject, expandDirIds, directories, folios]);

  /**
   * The set of ids that must be open, as a value rather than an object.
   *
   * ⚠️ This is what makes the reveal below fire on a change of TARGET rather
   * than on a change of anything the target happens to be derived from.
   * `expandDirIds` is a memo over `nodeById`, which takes a new identity
   * whenever the folio or directory lists change - so a rename, or creating a
   * sibling, used to re-run the reveal and re-open a directory the reader had
   * just closed. A rename does not move a node, so the id SET is identical
   * and this string does not change.
   */
  const expandSignature = useMemo(
    () => [...expandDirIds].sort().join("|"),
    [expandDirIds],
  );

  /**
   * The last set this hook actually revealed.
   *
   * A ref rather than state: it is read and written inside the effect and
   * must never cause a render of its own.
   */
  const revealedSignatureRef = useRef<string | undefined>(undefined);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // Later navigations only ever EXPAND the new target's path - never
  // collapse anything else. This is what keeps a directory open when
  // jumping from one of its folios to an unrelated root-level folio, and
  // what makes a `?dir=` link work when the workspace is already mounted.
  //
  // ⚠️ **`collapsed` is DELIBERATELY not a dependency, and reading it through
  // a ref is the point rather than a shortcut.** With it in the list, this
  // stopped being a response to a navigation and became an invariant: "a
  // selected folio's ancestors may never be collapsed". Collapsing the
  // directory holding the open folio wrote `collapsed`, which re-ran this,
  // which deleted the id again - so the row sprang back open on every click,
  // for as long as that folio stayed selected, and the chevron looked broken
  // rather than refused (feedback #2114). An invariant cannot be overridden
  // by the person using it, which is the whole bug.
  //
  // `react-hooks/exhaustive-deps` is OFF in this repo (`.oxlintrc.json` says
  // why), so nothing mechanical will stop the next reader adding `collapsed`
  // back to settle the warning their editor shows them. This comment is the
  // only guard there is.
  useEffect(() => {
    if (!seededForProject) return;
    if (revealedSignatureRef.current === expandSignature) return;
    // Recorded BEFORE the early return below, so navigating to a root-level
    // folio (nothing to reveal) still counts as having moved: coming back to
    // a folio inside a directory then reveals it again, as a navigation
    // should. It is also what lets the first pass, before the folio and
    // directory lists have loaded and while the set is empty, be superseded
    // once they arrive.
    revealedSignatureRef.current = expandSignature;
    if (expandDirIds.size === 0) return;

    let changed = false;
    const next = new Set(collapsedRef.current);
    for (const id of expandDirIds) {
      if (next.delete(id)) changed = true;
    }
    // Guarded on `changed`, so it settles in one pass.
    if (!changed) return;
    writeCollapsed(next);
  }, [expandSignature, seededForProject]);

  const { toggle, expandOne } = state.commands;

  const select = (node: FolioTreeNode): void => {
    if (node.data.kind === "directory") {
      toggle(node.id);
      return;
    }
    void router.push(
      router.path("projectFoliosFolio", {
        params: { projectSlug: input.projectSlug, shortId: node.data.shortId },
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
        if (node.data.kind === "directory") {
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

  // `useTreeState` clears `renamingId` once this resolves.
  renameActionRef.current = (id, name) => renameAction.run(id, name);

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

  /**
   * What a drop MEANS here. `useTreeState` owns the gesture and the guard
   * that the marker and the dropped-on row agree; resolving the move is
   * ours, because only this hook knows a directory from a folio and which
   * of the two endpoints writes the change.
   */
  moveRef.current = (currentDragId, targetId, position) => {
    const target = resolveDrop(tree, currentDragId, targetId, position);
    // `undefined` covers BOTH an illegal drop (into your own subtree) AND
    // a true no-op (already at that parent) — see `resolveDrop`'s own
    // doc. Either way, nothing to write.
    if (!target) return;

    const dragged = findFolioNode(tree, currentDragId);
    if (!dragged) return;

    if (dragged.data.kind === "directory") {
      void moveDirectoryAction.run(currentDragId, target.parentId);
    } else {
      void moveFolioAction.run(currentDragId, target.parentId);
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
        state.commands.beginRename(created.id);
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
        state.commands.beginRename(created.id);
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
    if (node.data.kind === "directory") {
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
        if (n.data.kind === "directory") removedDirIds.add(n.id);
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
        if (node.data.kind === "directory") return;
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
        if (node.data.kind === "directory") return;
        const updated = await folioApi.update({
          params: { id: node.id },
          body: { pinned: !node.data.pinned },
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
  const implRef = useRef<FolioTreeVerbs>(undefined as never);
  implRef.current = {
    select,
    createFolio,
    createDirectory,
    remove,
    duplicate,
    togglePin,
  };

  /**
   * The same commands behind a facade whose identity NEVER changes.
   *
   * This is what makes `TreeViewRow`'s memo worth anything. Before it, one
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
      // The generic half, already stable for the life of `useTreeState`.
      ...state.commands,
      // Lore's own verbs, through this hook's facade for the same reason.
      select: (node) => implRef.current.select(node),
      createFolio: (parentId) => implRef.current.createFolio(parentId),
      createDirectory: (parentId) => implRef.current.createDirectory(parentId),
      remove: (node) => implRef.current.remove(node),
      duplicate: (node) => implRef.current.duplicate(node),
      togglePin: (node) => implRef.current.togglePin(node),
    }),
    [state.commands],
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
