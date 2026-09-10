import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { cn } from "@alepha/ui/lib/utils";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useMemo, useState } from "react";

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
  const [apps, setApps] = useState<DashboardScopeApp[]>([]);
  const [tags, setTags] = useState<string[]>([]);

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

  const resolve = async (next: DashboardCardResource[]) => {
    if (!projectId) return;
    if (next.length === 0) {
      alepha.store.set(projectDashboardAtom, {
        projectId,
        cards: next,
        values: [],
      });
      return;
    }
    const resolved = await boardApi
      .resolveProjectDashboardCards({ params: { projectId }, body: {} })
      .catch(() => undefined);
    alepha.store.set(projectDashboardAtom, {
      projectId,
      cards: next,
      values: resolved?.values ?? [],
      refreshedAt: resolved?.refreshedAt,
    });
  };

  /**
   * One list-and-resolve per project.
   *
   * ⚠️ `cards` is deliberately NOT in the dependency list: every mutation
   * below re-resolves explicitly, and keying this on state the same effect
   * writes is precisely how a loader turns into a request loop.
   */
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      const held = alepha.store.get(projectDashboardAtom);
      const listed =
        held.projectId === projectId
          ? held.cards
          : ((
              await boardApi
                .listProjectDashboardCards({ params: { projectId } })
                .catch(() => undefined)
            )?.cards ?? []);
      if (!cancelled) await resolve(listed);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /**
   * What the scope and filter steps can offer, fetched only when the panel
   * opens: a board with no app-scoped or tag-filtered card never needs either,
   * and the project's landing page must not pay for a picker nobody opened.
   * Failures cost the picker its options, never the page.
   */
  useEffect(() => {
    if (!catalogueOpen || !projectId) return;
    let cancelled = false;
    void Promise.all([
      sigilApi
        .listSigils({ params: { projectId } })
        .then((res) =>
          res.items.map((sigil) => ({
            id: sigil.id,
            name: sigil.name,
            projectId,
            projectTitle: project?.title ?? "",
            beacon: (sigil.kinds ?? []).includes("beacon"),
          })),
        )
        .catch(() => []),
      questApi
        .listQuestTags({ query: { projectId } })
        .then((res) => res)
        .catch(() => []),
    ]).then(([foundApps, foundTags]) => {
      if (cancelled) return;
      setApps(foundApps);
      setTags(foundTags);
    });
    return () => {
      cancelled = true;
    };
  }, [catalogueOpen, projectId]);

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
    void resolve(next);
  };

  const currentCards = () => {
    const held = alepha.store.get(projectDashboardAtom);
    return held.projectId === projectId ? held.cards : [];
  };

  const onReorder = async (ids: number[]) => {
    if (!projectId) return;
    // Optimistic: the drop already moved the tile under the reader's cursor,
    // and putting it back for the length of a round-trip would read as the
    // drag having failed.
    const byId = new Map(currentCards().map((card) => [card.id, card]));
    const next = ids.map((id) => byId.get(id)!).filter(Boolean);
    alepha.store.set(projectDashboardAtom, {
      ...alepha.store.get(projectDashboardAtom),
      projectId,
      cards: next,
    });
    await boardApi
      .reorderProjectDashboardCards({ params: { projectId }, body: { ids } })
      .catch(() => undefined);
  };

  const onRemove = async (card: DashboardCardResource) => {
    if (!projectId) return;
    const confirmed = await dialog.confirm({
      title: String(tr("dashboard.card.delete.confirm")),
      description: String(tr("project.dashboard.card.delete.shared")),
      confirmLabel: String(tr("dashboard.card.delete")),
      destructive: true,
    });
    if (!confirmed) return;
    await boardApi.removeProjectDashboardCard({
      params: { projectId, cardId: card.id },
    });
    apply(currentCards().filter((it) => it.id !== card.id));
  };

  const onDuplicate = async (card: DashboardCardResource) => {
    if (!projectId) return;
    const made = await boardApi.addProjectDashboardCard({
      params: { projectId },
      body: { metric: card.metric, scope: card.scope, filters: card.filters },
    });
    apply([...currentCards(), made]);
  };

  const onAdd = async (input: {
    metric: string;
    scope: DashboardScope;
    filters: Record<string, unknown>;
  }) => {
    if (!projectId) return;
    const made = await boardApi.addProjectDashboardCard({
      params: { projectId },
      body: input as never,
    });
    setCatalogueOpen(false);
    apply([...currentCards(), made]);
  };

  const onUpdate = async (
    card: DashboardCardResource,
    input: { scope: DashboardScope; filters: Record<string, unknown> },
  ) => {
    if (!projectId) return;
    const updated = await boardApi.updateProjectDashboardCard({
      params: { projectId, cardId: card.id },
      body: input as never,
    });
    setCatalogueOpen(false);
    apply(currentCards().map((it) => (it.id === card.id ? updated : it)));
  };

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
            onReorder={onReorder}
            onAdd={openCatalogue}
            onChangeScope={(card) => {
              setEditing(card);
              setCatalogueOpen(true);
            }}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
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
        onAdd={onAdd}
        onUpdate={onUpdate}
      />
    </div>
  );
};

export default ProjectDashboard;
