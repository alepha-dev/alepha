import { useDialog, cn } from "@alepha/ui";
import {
  useAction,
  useAlepha,
  useClient,
  useInject,
  useQuery,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";

import type { ProjectDashboardController } from "@/api/controllers/ProjectDashboardController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { SigilController } from "@/api/controllers/SigilController.ts";
import type { DashboardCardResource } from "@/api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardScope } from "@/api/schemas/dashboardScopeSchema.ts";
import { DashboardMetricCatalog } from "@/api/services/DashboardMetricCatalog.ts";

import { currentEpicsAtom } from "../../../atoms/currentEpicsAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { projectDashboardAtom } from "../../../atoms/projectDashboardAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import DashboardCatalogue from "../../dashboard/DashboardCatalogue.tsx";
import { projectAnswers } from "../../dashboard/dashboardEligibility.ts";
import DashboardGrid from "../../dashboard/DashboardGrid.tsx";
import type { DashboardScopeApp } from "../../dashboard/DashboardScopeStep.tsx";
import { useRank } from "../../shared/useRank.ts";
import ProjectDashboardEmpty from "./ProjectDashboardEmpty.tsx";
import ProjectDashboardHeader from "./ProjectDashboardHeader.tsx";

/**
 * A project's board: where you land when you open the project.
 *
 * ## Everything visual is home's, unchanged
 *
 * `DashboardGrid`, `DashboardCard`, its value, footer and menu, the Add tile,
 * the catalogue and the filter step are all reused as they are. None of them
 * knows which board it is on; the two rules that differ reach them as props
 * (`boardProjectId` for the chip, `canEdit` for the affordances), which is why
 * this page is short.
 *
 * What does NOT come along is `DashboardRail`, `DashboardRailProject` and
 * `DashboardProjectsSection` - all three are about picking a project, and you
 * are inside one - and `DashboardHeader`, which greets the account by name
 * over what is a shared surface here.
 *
 * ## The seam is the fetch and the mutations
 *
 * Home talks to `/me/dashboard/...` and this talks to
 * `/projects/:projectId/dashboard/...`. That is the whole difference, so it is
 * the only thing extracted: the presentation is shared rather than branched.
 *
 * ## The board is usually EMPTY, and that shapes this page
 *
 * Nothing seeds a project board, so zero cards is the normal first render on
 * most projects and possibly forever on a Knowledge-only one. The empty state
 * is written as the ordinary case rather than as a fallback at the bottom.
 *
 * ## One resolve, no polling
 *
 * The route loader fills the card list so the grid lays out with the right
 * tiles before a number exists; this resolves once on mount and after any
 * mutation. ⚠️ There is deliberately no interval anywhere: ten
 * auto-refreshing tiles is the exact shape of the QuestGraph incident (folio
 * #1057), 4,009 identical `/api/_batch` requests from one browser tab in 51
 * minutes.
 */
const ProjectDashboard = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const dialog = useDialog();
  const rank = useRank();
  const catalog = useInject(DashboardMetricCatalog);
  const boardApi = useClient<ProjectDashboardController>();
  const sigilApi = useClient<SigilController>();
  const questApi = useClient<QuestController>();

  const [project] = useStore(currentProjectAtom);
  const [board] = useStore(projectDashboardAtom);
  // ⚠️ Read, never fetched. The `project` route loader already issues both
  // (`getEpicRefs` and `getReleases`, inside the one `Promise.all` the
  // browser coalesces into a single `/api/_batch`), so the epic and release
  // pickers cost this page no request at all. Fetching them here would add a
  // round trip for a list already in the store.
  const [epics] = useStore(currentEpicsAtom);
  const [releases] = useStore(currentReleasesAtom);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [editing, setEditing] = useState<DashboardCardResource | undefined>();

  const projectId = project?.id;
  /**
   * ⚠️ **Never enforcement.** The server refuses the same writes whatever
   * this hides; what it buys is a board that does not advertise controls the
   * reader cannot use. `ProjectRankPresets.CONTRIBUTOR` does not carry
   * `project:update`, so this is the common case rather than the corner one.
   */
  const canEdit = rank.can("project:update");

  const metrics = useMemo(
    () => new Map(catalog.all().map((metric) => [metric.key, metric])),
    [catalog],
  );

  /**
   * Whether this project can answer any project-board metric at all.
   *
   * Read off the metric's own `needs` rather than by naming a capability, so
   * a metric added tomorrow is covered. All four are Work today, which is why
   * a Knowledge-only project has an empty board and no way to fill it - a
   * true state the empty state has to be able to say.
   */
  const hasOfferableMetric = useMemo(
    () =>
      catalog.on("project").some((metric) => projectAnswers(metric, project)),
    [catalog, project],
  );

  /**
   * The cards this atom holds, but only if they belong to the open project.
   *
   * The atom outlives one page, so a stale project's list would otherwise
   * paint for a frame on the way in.
   */
  const cards = board.projectId === projectId ? board.cards : [];
  const values = board.projectId === projectId ? board.values : undefined;

  /**
   * One list-and-resolve per project, and a resolve after each mutation.
   *
   * Lists only when the store does not already hold this project's cards, so
   * a mutation (which writes them first and calls this through `refetch`)
   * resolves without listing again. A project change supersedes the run in
   * flight, and the `signal` check keeps its late answer out of the store.
   *
   * ⚠️ Reads the cards from the store, never from a dependency: keying this on
   * state it writes is precisely how a loader turns into a request loop.
   */
  const loadAction = useAction<[], void>(
    {
      handler: async ({ signal }) => {
        if (!projectId) return;
        const held = alepha.store.get(projectDashboardAtom);
        const listed =
          held.projectId === projectId
            ? held.cards
            : (
                await boardApi.listProjectDashboardCards({
                  params: { projectId },
                })
              ).cards;
        if (signal.aborted) return;
        if (listed.length === 0) {
          alepha.store.set(projectDashboardAtom, {
            projectId,
            cards: listed,
            values: [],
          });
          return;
        }
        const resolved = await boardApi.resolveProjectDashboardCards({
          params: { projectId },
          body: {},
        });
        if (signal.aborted) return;
        const current = alepha.store.get(projectDashboardAtom);
        alepha.store.set(projectDashboardAtom, {
          projectId,
          // A mutation that landed while this resolved wrote the newer list.
          cards: current.projectId === projectId ? current.cards : listed,
          values: resolved.values,
          refreshedAt: resolved.refreshedAt,
        });
      },
      // Quiet on purpose: a board that cannot list or resolve renders its
      // cards empty (or its empty state), and error reporting still sees it.
      onError: () => {
        if (!projectId) return;
        const held = alepha.store.get(projectDashboardAtom);
        alepha.store.set(projectDashboardAtom, {
          projectId,
          cards: held.projectId === projectId ? held.cards : [],
          values: [],
        });
      },
      runOnInit: true,
    },
    [alepha, boardApi, projectId],
  );

  /**
   * What the scope and filter steps can offer, fetched only when the panel
   * opens: a board with no app-scoped or tag-filtered card never needs either,
   * and the project's landing page must not pay for a picker nobody opened.
   * Each read's failure costs the picker its options, never the page: the two
   * catches are deliberate partial success, not swallowed errors.
   */
  const pickers = useQuery(
    {
      key: ["project-dashboard-pickers", projectId],
      staleTime: [5, "minutes"],
      enabled: catalogueOpen && !!projectId,
      handler: async () => {
        const id = projectId as number;
        const [foundApps, foundTags] = await Promise.all([
          sigilApi
            .listSigils({ params: { projectId: id } })
            .then((res) =>
              res.items.map((sigil) => ({
                id: sigil.id,
                name: sigil.name,
                projectId: id,
                projectTitle: project?.title ?? "",
                beacon: (sigil.kinds ?? []).includes("beacon"),
              })),
            )
            .catch((): DashboardScopeApp[] => []),
          questApi
            .listQuestTags({ query: { projectId: id } })
            .catch((): string[] => []),
        ]);
        return { apps: foundApps, tags: foundTags };
      },
    },
    [sigilApi, questApi, projectId, catalogueOpen],
  ).data;
  const apps = pickers?.apps ?? [];
  const tags = pickers?.tags ?? [];

  /**
   * Adopt a new card list and re-resolve it.
   *
   * Reads the base state out of the store rather than out of the render
   * closure: two mutations in quick succession would otherwise have the
   * second overwrite the first with a list it never saw.
   */
  const apply = (next: DashboardCardResource[]) => {
    if (!projectId) return;
    alepha.store.set(projectDashboardAtom, {
      ...alepha.store.get(projectDashboardAtom),
      projectId,
      cards: next,
    });
    void loadAction.refetch();
  };

  const currentCards = () => {
    const held = alepha.store.get(projectDashboardAtom);
    return held.projectId === projectId ? held.cards : [];
  };

  const reorderAction = useAction<[ids: number[]], void>(
    {
      handler: async (ids) => {
        if (!projectId) return;
        // Optimistic: the drop already moved the tile under the reader's
        // cursor, and putting it back for the length of a round-trip would
        // read as the drag having failed.
        const byId = new Map(currentCards().map((card) => [card.id, card]));
        const next = ids.map((id) => byId.get(id)!).filter(Boolean);
        alepha.store.set(projectDashboardAtom, {
          ...alepha.store.get(projectDashboardAtom),
          projectId,
          cards: next,
        });
        await boardApi.reorderProjectDashboardCards({
          params: { projectId },
          body: { ids },
        });
      },
      // ⚠️ Deliberately quiet, and deliberately no rollback: a failed reorder
      // keeps the new order on screen until the next load, and does not
      // toast. A tile that jumped back after the drop would read as the drag
      // failing, and error reporting still sees the refusal.
      onError: () => {},
    },
    [alepha, boardApi, projectId],
  );

  const removeAction = useAction<[card: DashboardCardResource], void>(
    {
      handler: async (card) => {
        if (!projectId) return;
        const confirmed = await dialog.confirm({
          title: tr("dashboard.card.delete.confirm"),
          description: tr("project.dashboard.card.delete.shared"),
          confirmLabel: tr("dashboard.card.delete"),
          destructive: true,
        });
        if (!confirmed) return;
        await boardApi.removeProjectDashboardCard({
          params: { projectId, cardId: card.id },
        });
        apply(currentCards().filter((it) => it.id !== card.id));
      },
    },
    [alepha, boardApi, dialog, projectId, tr],
  );

  const duplicateAction = useAction<[card: DashboardCardResource], void>(
    {
      handler: async (card) => {
        if (!projectId) return;
        const made = await boardApi.addProjectDashboardCard({
          params: { projectId },
          body: {
            metric: card.metric,
            scope: card.scope,
            filters: card.filters,
          },
        });
        apply([...currentCards(), made]);
      },
    },
    [alepha, boardApi, projectId],
  );

  const addAction = useAction<
    [
      input: {
        metric: string;
        scope: DashboardScope;
        filters: Record<string, unknown>;
      },
    ],
    void
  >(
    {
      handler: async (input) => {
        if (!projectId) return;
        const made = await boardApi.addProjectDashboardCard({
          params: { projectId },
          body: input as never,
        });
        setCatalogueOpen(false);
        apply([...currentCards(), made]);
      },
    },
    [alepha, boardApi, projectId],
  );

  const updateAction = useAction<
    [
      card: DashboardCardResource,
      input: { scope: DashboardScope; filters: Record<string, unknown> },
    ],
    void
  >(
    {
      handler: async (card, input) => {
        if (!projectId) return;
        const updated = await boardApi.updateProjectDashboardCard({
          params: { projectId, cardId: card.id },
          body: input as never,
        });
        setCatalogueOpen(false);
        apply(currentCards().map((it) => (it.id === card.id ? updated : it)));
      },
    },
    [alepha, boardApi, projectId],
  );

  /**
   * Every card control waits while a write runs (#E59 rule 10).
   */
  const busy =
    removeAction.loading ||
    duplicateAction.loading ||
    addAction.loading ||
    updateAction.loading;

  const openCatalogue = () => {
    setEditing(undefined);
    setCatalogueOpen(true);
  };

  // ⚠️ At zero cards the empty state is the whole page (feedback #P2180): no
  // header, no heading, no Add button up top. It carries Add card itself, and
  // the page stretches so it can centre on both axes of the content area.
  const empty = cards.length === 0;

  return (
    <div
      className={cn(
        "@container flex min-h-0 w-full flex-col px-8 pt-6 pb-10",
        empty && "flex-1",
      )}
    >
      {empty ? (
        <ProjectDashboardEmpty
          canEdit={canEdit}
          hasOfferableMetric={hasOfferableMetric}
          onAdd={openCatalogue}
        />
      ) : (
        <>
          <ProjectDashboardHeader
            cardCount={cards.length}
            refreshedAt={board.refreshedAt}
            canEdit={canEdit}
            onAdd={openCatalogue}
          />

          <DashboardGrid
            cards={cards}
            values={values}
            metrics={metrics}
            boardProjectId={projectId}
            canEdit={canEdit}
            onReorder={(ids) => void reorderAction.run(ids)}
            onAdd={openCatalogue}
            onChangeScope={(card) => {
              setEditing(card);
              setCatalogueOpen(true);
            }}
            onDuplicate={(card) => void duplicateAction.run(card)}
            onRemove={(card) => void removeAction.run(card)}
            busy={busy}
          />
        </>
      )}

      {/*
       * Kept mounted and re-keyed rather than mounted by a condition: the
       * drawer needs to survive `open` going false long enough to animate
       * out, and its step state has to start from `editing` every time the
       * panel opens for a different card.
       */}
      <DashboardCatalogue
        key={editing?.id ?? "new"}
        open={catalogueOpen}
        board="project"
        boardProjectId={projectId}
        cards={cards}
        projects={project ? [project] : []}
        apps={apps}
        epics={epics ?? []}
        releases={releases ?? []}
        projectTags={tags}
        editing={editing}
        onClose={() => setCatalogueOpen(false)}
        onAdd={(input) => void addAction.run(input)}
        onUpdate={(card, input) => void updateAction.run(card, input)}
        busy={busy}
      />
    </div>
  );
};

export default ProjectDashboard;
