import { useDialog, cn } from "@alepha/ui";
import {
  useAction,
  useAlepha,
  useClient,
  useInject,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";

import type { ProjectDashboardController } from "../../../../../api/controllers/ProjectDashboardController.ts";
import type { DashboardCardResource } from "../../../../../api/schemas/dashboardCardResourceSchema.ts";
import { DashboardMetricCatalog } from "../../../../../api/schemas/DashboardMetricCatalog.ts";
import type { DashboardScope } from "../../../../../api/schemas/dashboardScopeSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { dashboardWindowAtom } from "../../../atoms/dashboardWindowAtom.ts";
import { projectDashboardAtom } from "../../../atoms/projectDashboardAtom.ts";
import { DashboardPickerRegistry } from "../../../registries/DashboardPickerRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import DashboardCatalogue from "../../dashboard/DashboardCatalogue.tsx";
import { projectAnswers } from "../../dashboard/dashboardEligibility.ts";
import DashboardGrid from "../../dashboard/DashboardGrid.tsx";
import { useRank } from "../../shared/useRank.ts";
import ProjectDashboardArchived from "./ProjectDashboardArchived.tsx";
import ProjectDashboardDormant from "./ProjectDashboardDormant.tsx";
import ProjectDashboardEmpty from "./ProjectDashboardEmpty.tsx";
import ProjectDashboardHeader from "./ProjectDashboardHeader.tsx";
import ProjectDashboardHeadline from "./ProjectDashboardHeadline.tsx";

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
  const pickers = useInject(DashboardPickerRegistry).sources();

  const [project] = useStore(currentProjectAtom);
  const [board] = useStore(projectDashboardAtom);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [editing, setEditing] = useState<DashboardCardResource | undefined>();
  /**
   * Edit mode: Add, the card menus and drag, and the tiles that have nothing
   * to show (#Q2649). Out of it the board is a reading surface for everyone,
   * curators included.
   */
  const [editMode, setEditMode] = useState(false);

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
  /**
   * The computed default board (#Q2652): read-only for everyone, no card
   * menu, no drag. Curation starts from Customize.
   */
  const computed = board.projectId === projectId && !!board.computed;
  const values = board.projectId === projectId ? board.values : undefined;

  /**
   * The cards a reader sees: every card but the ones whose metric answered
   * `empty` (#Q2649), which only edit mode shows, collapsed, with the
   * reason. A reader never sees a permanent zero. Before the first resolve
   * every card shows, as a skeleton.
   */
  const shown = useMemo(() => {
    if (editMode || !values) return cards;
    const empty = new Set(
      values.filter((value) => value.empty).map((value) => value.cardId),
    );
    return cards.filter((card) => !empty.has(card.id));
  }, [cards, values, editMode]);

  /**
   * The board, in one request: stored cards and their values, or the
   * computed default when the project has none (#Q2652).
   *
   * Runs on mount only when the route loader did not already fill the store
   * for this project (a client-side navigation whose loader failed, say), and
   * after every mutation through `refetch`. A project change supersedes the
   * run in flight, and the `signal` check keeps its late answer out.
   *
   * ⚠️ Reads the store, never a dependency it writes: keying this on state
   * it sets is precisely how a loader turns into a request loop (folio #1057).
   */
  const loadAction = useAction<[], void>(
    {
      handler: async ({ signal }) => {
        if (!projectId) return;
        const board = await boardApi.getProjectDashboard({
          params: { projectId },
          query: { window: alepha.store.get(dashboardWindowAtom).days },
        });
        if (signal.aborted) return;
        alepha.store.set(projectDashboardAtom, {
          projectId,
          computed: board.computed,
          dormantSince: board.dormantSince,
          cards: board.cards,
          values: board.values,
          refreshedAt: board.refreshedAt,
        });
      },
      // Quiet on purpose: a board that cannot load renders its empty state,
      // and error reporting still sees it.
      onError: () => {
        if (!projectId) return;
        const held = alepha.store.get(projectDashboardAtom);
        alepha.store.set(projectDashboardAtom, {
          projectId,
          computed: held.projectId === projectId ? held.computed : undefined,
          cards: held.projectId === projectId ? held.cards : [],
          values: [],
        });
      },
      // Only when the route loader did not fill the store for this project.
      // Never for an archived project: it has no board to load (#Q2662).
      runOnInit:
        !!projectId &&
        !project?.archivedAt &&
        (board.projectId !== projectId || !board.values),
    },
    [alepha, boardApi, projectId],
  );

  /**
   * What the scope and filter steps can offer, from the modules that own it
   * (`DashboardPickerRegistry`, #E75 #Q2624): Deploy's apps, Work's tags,
   * epics and releases. Fetched only when the panel opens: a board with no
   * app-scoped or tag-filtered card never needs either, and the project's
   * landing page must not pay for a picker nobody opened. Each source is a
   * hook, called once per render; the registry is frozen before the first,
   * so the loop below is the same length every time.
   */
  const pickerContext = {
    projectId,
    projectTitle: project?.title ?? "",
    open: catalogueOpen,
  };
  const apps = pickers.apps?.useApps(pickerContext) ?? [];
  const tags = pickers.tags?.useTags(pickerContext) ?? [];
  const subjects = pickers.subjects.map((picker) => ({
    picker,
    options: picker.useOptions(pickerContext),
  }));

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

  /**
   * The STORED cards the store holds: none while it shows the computed board,
   * whose tiles are not rows and must never be written back as if they were.
   */
  const currentCards = () => {
    const held = alepha.store.get(projectDashboardAtom);
    return held.projectId === projectId && !held.computed ? held.cards : [];
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
   * Width and height from the card menu (#Q2651).
   */
  const resizeAction = useAction<
    [card: DashboardCardResource, size: { size: number; height: number }],
    void
  >(
    {
      handler: async (card, size) => {
        if (!projectId) return;
        const updated = await boardApi.updateProjectDashboardCard({
          params: { projectId, cardId: card.id },
          body: size,
        });
        apply(currentCards().map((it) => (it.id === card.id ? updated : it)));
      },
    },
    [alepha, boardApi, projectId],
  );

  /**
   * "Customize" (#Q2660): copy the computed tiles into stored cards in one
   * write, then open edit mode on them.
   */
  const customizeAction = useAction<[], void>(
    {
      handler: async () => {
        if (!projectId) return;
        const made = await boardApi.customizeProjectDashboard({
          params: { projectId },
        });
        alepha.store.set(projectDashboardAtom, {
          ...alepha.store.get(projectDashboardAtom),
          projectId,
          computed: false,
          cards: made.cards,
        });
        setEditMode(true);
        void loadAction.refetch();
      },
    },
    [alepha, boardApi, projectId],
  );

  /**
   * "Reset to default" (#Q2660): every member sees the computed board again.
   */
  const resetAction = useAction<[], void>(
    {
      handler: async () => {
        if (!projectId) return;
        const confirmed = await dialog.confirm({
          title: tr("dashboard.reset.confirm"),
          description: tr("dashboard.reset.description"),
          confirmLabel: tr("dashboard.reset"),
          destructive: true,
        });
        if (!confirmed) return;
        await boardApi.resetProjectDashboard({ params: { projectId } });
        setEditMode(false);
        await loadAction.refetch();
      },
    },
    [alepha, boardApi, dialog, projectId, tr],
  );

  /**
   * Every card control waits while a write runs (#E59 rule 10).
   */
  const busy =
    removeAction.loading ||
    duplicateAction.loading ||
    addAction.loading ||
    updateAction.loading ||
    resizeAction.loading ||
    customizeAction.loading ||
    resetAction.loading;

  const openCatalogue = () => {
    setEditing(undefined);
    setCatalogueOpen(true);
  };

  // ⚠️ At zero cards the empty state is the whole page (feedback #P2180): no
  // header, no heading, no Add button up top. It carries Add card itself, and
  // the page stretches so it can centre on both axes of the content area.
  const empty = cards.length === 0;

  // An archived project has no board (#Q2662): a notice and a link to what
  // it kept, rendered here, never a redirect.
  if (project?.archivedAt) {
    const has = (key: string) =>
      project.capabilities.some((capability) => capability.key === key);
    return (
      <div className="@container flex min-h-0 w-full flex-1 flex-col px-8 pt-6 pb-10">
        <ProjectDashboardArchived
          projectSlug={project.slug ?? ""}
          destination={
            has("knowledge")
              ? "projectFolios"
              : has("work")
                ? "projectQuests"
                : undefined
          }
        />
      </div>
    );
  }

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
            cardCount={shown.length}
            refreshedAt={board.refreshedAt}
            canEdit={canEdit}
            computed={computed}
            editing={editMode && !computed}
            onToggleEditing={() => setEditMode((on) => !on)}
            onAdd={openCatalogue}
            onCustomize={() => void customizeAction.run()}
            onWindowChange={(days) => {
              // One resolve per change, never an interval (folio #1057).
              alepha.store.set(dashboardWindowAtom, { days });
              void loadAction.refetch();
            }}
            onReset={() => void resetAction.run()}
            busy={busy}
          />

          {computed && !board.dormantSince && (
            <ProjectDashboardHeadline cards={shown} values={values} />
          )}

          {computed && board.dormantSince && (
            <ProjectDashboardDormant since={board.dormantSince} />
          )}

          <DashboardGrid
            cards={shown}
            values={values}
            metrics={metrics}
            boardProjectId={projectId}
            canEdit={canEdit && editMode && !computed}
            onReorder={(ids) => void reorderAction.run(ids)}
            onAdd={openCatalogue}
            onChangeScope={(card) => {
              setEditing(card);
              setCatalogueOpen(true);
            }}
            onResize={(card, size) => void resizeAction.run(card, size)}
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
        subjects={subjects}
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
