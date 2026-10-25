import {
  $pageProject,
  $pageProjectSettings,
  currentProjectAtom,
  hasCapability,
  canInProject,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $page } from "alepha/react/router";
import { NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";

import type { DirectoryController } from "../../api/controllers/DirectoryController.ts";
import type { FolioController } from "../../api/controllers/FolioController.ts";
import { currentFolioAttachmentsAtom } from "./atoms/currentFolioAttachmentsAtom.ts";
import { folioTreeSeedAtom } from "./atoms/folioTreeSeedAtom.ts";
import { projectDirectoriesAtom } from "./atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "./atoms/userFoliosAtom.ts";

/**
 * Knowledge's pages (#E75): the folios workspace and its settings tab.
 * Each page mounts under core with `$pageProject` or `parent:`, so no
 * router names another module's page.
 */
export class KnowledgeRouter {
  alepha = $inject(Alepha);
  folioApi = $client<FolioController>();
  directoryApi = $client<DirectoryController>();
  dateTime = $inject(DateTimeProvider);

  /**
   * How long a folio-tree seed stays usable. Matches the `staleTime` on
   * `useFolioTreeModel`'s fallback query so both halves of the tree's
   * freshness policy say the same thing.
   */
  protected static readonly FOLIO_TREE_TTL_MS = 30_000;

  /**
   * Fill `userFoliosAtom` + `projectDirectoriesAtom` — the two lists the
   * folio tree pane renders from — unless they already hold this
   * project's rows and were filled recently. See `folioTreeSeedAtom` for
   * why the unconditional fetch these loaders used to do was two wasted
   * HTTP calls per folio opened.
   *
   * Deliberately does no `await` before deciding: callers put it in a
   * `Promise.all` next to their own fetch, and anything awaited ahead of
   * the decision would push these calls into a later tick and out of the
   * `BatchCollector` window they need to share.
   */
  protected async seedFolioTree(projectId: number): Promise<void> {
    const seed = this.alepha.store.get(folioTreeSeedAtom);
    const now = this.dateTime.nowMillis();
    if (
      seed &&
      seed.projectId === projectId &&
      now - seed.at < KnowledgeRouter.FOLIO_TREE_TTL_MS
    ) {
      return;
    }
    const [folios, directories] = await Promise.all([
      this.folioApi.tree({ params: { projectId } }),
      this.directoryApi.listAllDirectories({ params: { projectId } }),
    ]);
    this.alepha.store.set(userFoliosAtom, folios);
    this.alepha.store.set(projectDirectoriesAtom, directories);
    this.alepha.store.set(folioTreeSeedAtom, { projectId, at: now });
  }

  // Quest #66 originally split this from the entity-level "folios" naming
  // by giving it its own URL path (/archive), when the directory tree +
  // blobs were a distinct "Archive" module. The 2026-08 great rename
  // (Task 5) folded that module back into Folios — entities, MCP tools,
  // and now the URL path are all "folio(s)"-named again. Internal route
  // name stays `projectFolios`, unchanged since before quest #66.
  projectFolios = $pageProject({
    name: "projectFolios",
    children: () => [this.projectFoliosNew, this.projectFoliosFolio],
    path: "/folios",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Folios`,
    }),
    lazy: () => import("./components/folios/FoliosLayout.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      const projectId = project?.id;
      if (projectId === undefined) {
        throw new NotFoundError("Project not found");
      }
      if (!hasCapability(project, "knowledge")) {
        throw new NotFoundError("Knowledge is not enabled for this project");
      }
      // ⚠️ A permission NAME, and a module-level function rather than
      // `useRank()`: a `$page` loader runs outside React and cannot call a
      // hook, and the loader and the component must not disagree about which
      // pages exist. Same arrangement as `hasCapability` beside it.
      //
      // 404 rather than 403, matching the capability guard above it: a page
      // the reader may not open is a page that does not exist for them, and a
      // 403 would confirm what is behind it.
      if (!canInProject(project, "folio:read")) {
        throw new NotFoundError("Your rank does not open folios here");
      }
      // The tree's own two lists, which `seedFolioTree` owns — the folio
      // list AND the directory list, the latter load-bearing: the tree's
      // fallback
      // `useQuery` is gated on `enabled: !seeded`, where "seeded" is
      // satisfied by `userFoliosAtom` ALONE. Any project with at least one
      // folio therefore looked seeded the moment the folio list resolved,
      // the fallback never ran, and a hard load of `/folios` rendered a
      // tree with no directories in it — every nested folio flat at the
      // root.
      //
      // The directory-contents fetch and the `?dir=` resolution that used
      // to sit here went with `FolioBrowser` — they existed to fill its
      // table and its breadcrumb. A folio page sets its own breadcrumb
      // from the folio's `metadata.path`, so nothing downstream reads
      // them any more.
      await this.seedFolioTree(projectId);
    },
    onLeave: () => {
      this.alepha.store.set(currentFolioAttachmentsAtom, []);
    },
  });

  projectSettingsKnowledge = $pageProjectSettings({
    name: "projectSettingsKnowledge",
    path: "/knowledge",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Folios`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsKnowledgePage.tsx"),
  });

  projectFoliosNew = $page({
    name: "projectFoliosNew",
    path: "/new",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › New`,
    }),
    lazy: () => import("./components/folios/FolioCreatePage.tsx"),
    loader: async ({ url }) => {
      // A draft has no attachments of its own: without this the last opened
      // folio's attachments were offered in the new folio's link picker.
      this.alepha.store.set(currentFolioAttachmentsAtom, []);
      // Carry the source directory across the navigation: the folio tree's
      // create link adds `?dir=<shortId>` when the user is in a directory; resolve to a UUID here so the editor can pass
      // it to `folioApi.create({ directoryId })`. Without this, every
      // folio created from this page lands at the project root
      // regardless of the directory the user clicked from.
      const dirParam = url.searchParams.get("dir");
      const project = this.alepha.store.get(currentProjectAtom);
      let directoryId: string | undefined;
      if (dirParam && project) {
        const shortId = Number.parseInt(dirParam, 10);
        if (Number.isFinite(shortId)) {
          try {
            const dir = await this.directoryApi.getDirectoryByShortId({
              params: { projectId: project.id, shortId },
            });
            directoryId = dir.id;
          } catch {
            // Stale `?dir` — fall back to root.
            directoryId = undefined;
          }
        }
      }
      // Populate the tree's lists so the document workspace's meta bar
      // (Task 8) can resolve the create-mode `directoryId` above to a
      // display name — the chip shows where the new folio WILL land, even
      // though it's not clickable yet (there's no row for `folio.move` to
      // act on until the folio is saved). Landing directly on
      // `/folios/new` (rather than navigating here from `/folios`)
      // previously left `projectDirectoriesAtom` unset or stale from a
      // prior folio view. Going through `seedFolioTree` also fills
      // `userFoliosAtom`, which this loader never did and which the tree
      // pane's `enabled: !seeded` fallback then had to fetch on mount.
      if (project) {
        await this.seedFolioTree(project.id);
      }
      return { directoryId };
    },
  });

  projectFoliosFolio = $page({
    name: "projectFoliosFolio",
    path: "/:shortId",
    schema: {
      params: z.object({ shortId: z.integer() }),
    },
    head: (props, previous) => {
      const folio = (
        props as
          | {
              folio?: {
                title?: string;
                metadata?: { path?: { name: string }[] };
              };
            }
          | undefined
      )?.folio;
      const path = folio?.metadata?.path ?? [];
      const dirPrefix =
        path.length > 0 ? `${path.map((p) => p.name).join("/")}/` : "";
      return {
        title: `${previous?.title ?? ""} › ${dirPrefix}${folio?.title ?? "Folio"}`,
      };
    },
    lazy: () => import("./components/folios/editor/FolioWorkspace.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // ONE call opens a folio. Everything the workspace needs that keys
      // off the folio itself — its links, its directory chain, its
      // attachments, its revision count — is asked for on the folio
      // request, because each of those used to be a follow-up round-trip
      // that could only START once this one had resolved (they address
      // the folio by `id`, and the URL only carries `shortId`). Sitting
      // after the `await`, they were far past the 10ms `BatchCollector`
      // window and could never join it. See Lore #109.
      //
      // `seedFolioTree` rides alongside and is usually a no-op: the
      // `/folios` layout loader that necessarily ran before this one
      // already filled the tree's lists, and a layout loader is not
      // re-run on child navigation. When it does have to fetch, it does
      // so in this same tick and batches with the folio.
      const [folio] = await Promise.all([
        this.folioApi.getByShortId({
          params: { projectId: project.id, shortId: params.shortId },
          query: {
            withLinks: true,
            withPath: true,
            withAttachments: true,
          },
        }),
        this.seedFolioTree(project.id),
      ]);
      this.alepha.store.set(
        currentFolioAttachmentsAtom,
        folio.metadata?.attachments ?? [],
      );
      // ⚠️ No breadcrumb write. The header used to read "Lore › Folios ›
      // <dirs…> › <folio title>", built from `folio.metadata.path` through
      // `currentFolioPathAtom`; it reads "Lore › Folios › #F12" now
      // (feedback #P2137), which `ProjectView` takes from the route params.
      // The atom had no other consumer and is gone.
      return { folio };
    },
  });
}
