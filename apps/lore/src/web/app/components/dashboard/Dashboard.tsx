import { useDialog } from "@alepha/ui";
import {
  useAction,
  useAlepha,
  useClient,
  useInject,
  useQuery,
  useStore,
} from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";

import type { DashboardController } from "@/api/controllers/DashboardController.ts";
import type { SigilController } from "@/api/controllers/SigilController.ts";
import type { DashboardCardResource } from "@/api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardScope } from "@/api/schemas/dashboardScopeSchema.ts";
import { DashboardMetricCatalog } from "@/api/services/DashboardMetricCatalog.ts";

import { dashboardAtom } from "../../atoms/dashboardAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";
import DashboardCatalogue from "./DashboardCatalogue.tsx";
import DashboardEmpty from "./DashboardEmpty.tsx";
import DashboardGrid from "./DashboardGrid.tsx";
import DashboardHeader from "./DashboardHeader.tsx";
import DashboardProjectsSection from "./DashboardProjectsSection.tsx";
import DashboardRail from "./DashboardRail.tsx";
import type { DashboardScopeApp } from "./DashboardScopeStep.tsx";

/**
 * The signed-in landing page.
 *
 * ## What it replaces, and what it does not
 *
 * Home is still the hero for an anonymous visitor and for a signed-in user
 * with no projects: a dashboard of empty tiles is a worse first run than a
 * welcome. `Home.tsx` makes that call and renders this instead when there is
 * something to show.
 *
 * ## One resolve, no polling
 *
 * The `home` route loader fills the card list, so the grid lays out with the
 * right tiles, titles and chips before a single number exists. This
 * component then resolves them **once**, on mount, and after any mutation
 * that changes what the board contains.
 *
 * ⚠️ There is deliberately no interval anywhere. Ten auto-refreshing tiles on
 * the landing page is the exact shape of the QuestGraph incident (folio
 * #1057): a route loader revalidating once per second for 51 minutes produced
 * 4,009 identical `/api/_batch` requests from one browser tab, roughly 35% of
 * that day's account-wide Worker invocations. The header's "refreshed ..."
 * line is a timestamp, not a heartbeat.
 */
const Dashboard = () => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const auth = useAuth();
  const dialog = useDialog();
  const catalog = useInject(DashboardMetricCatalog);
  const dashboardApi = useClient<DashboardController>();
  const sigilApi = useClient<SigilController>();

  const [dashboard] = useStore(dashboardAtom);
  const [overview] = useStore(userProjectsAtom);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [editing, setEditing] = useState<DashboardCardResource | undefined>();

  const projects = overview?.projects ?? [];
  const metrics = useMemo(
    () => new Map(catalog.all().map((metric) => [metric.key, metric])),
    [catalog],
  );

  /**
   * Resolve the cards the store holds, once per mount and after each
   * mutation (which calls it through `refetch`, so a newer resolve
   * supersedes one in flight instead of being dropped).
   *
   * ⚠️ Reads the cards from the store, never from a dependency: keying this on
   * state it writes is precisely how a loader turns into a request loop.
   */
  const resolveAction = useAction<[], void>(
    {
      handler: async ({ signal }) => {
        const cards = alepha.store.get(dashboardAtom).cards;
        if (cards.length === 0) {
          alepha.store.set(dashboardAtom, { cards, values: [] });
          return;
        }
        const resolved = await dashboardApi.resolveCards({ body: {} });
        if (signal.aborted) return;
        alepha.store.set(dashboardAtom, {
          cards: alepha.store.get(dashboardAtom).cards,
          values: resolved.values,
          refreshedAt: resolved.refreshedAt,
        });
      },
      // Quiet on purpose: a card that cannot resolve renders empty, and the
      // board around it stays usable. Error reporting still sees it.
      onError: () => {
        alepha.store.set(dashboardAtom, {
          ...alepha.store.get(dashboardAtom),
          values: [],
        });
      },
      runOnInit: true,
    },
    [alepha, dashboardApi],
  );

  /**
   * The apps the scope picker can offer, across every project.
   *
   * One request per project, and only when the panel opens: a card list with
   * no app-scoped metric never needs them, and the landing page must not pay
   * for a picker nobody opened. Kept five minutes, so reopening the panel
   * does not ask again. Each project's failure costs the picker that
   * project's options, never the page: the per-project catch is deliberate
   * partial success, not a swallowed error.
   */
  const apps: DashboardScopeApp[] =
    useQuery(
      {
        key: ["dashboard-scope-apps", ...projects.map((it) => it.id)],
        staleTime: [5, "minutes"],
        enabled: catalogueOpen && projects.length > 0,
        handler: async () =>
          (
            await Promise.all(
              projects.map((project) =>
                sigilApi
                  .listSigils({ params: { projectId: project.id } })
                  .then((res) =>
                    res.items.map((sigil) => ({
                      id: sigil.id,
                      name: sigil.name,
                      projectId: project.id,
                      projectTitle: project.title,
                      beacon: (sigil.kinds ?? []).includes("beacon"),
                    })),
                  )
                  .catch((): DashboardScopeApp[] => []),
              ),
            )
          ).flat(),
      },
      [sigilApi, projects.length, catalogueOpen],
    ).data ?? [];

  /**
   * Adopt a new card list and re-resolve it.
   *
   * Reads the base state out of the store rather than out of the render
   * closure: `dashboard` is captured at render time, and two mutations in
   * quick succession would have the second overwrite the first with a list it
   * never saw.
   */
  const apply = (cards: DashboardCardResource[]) => {
    alepha.store.set(dashboardAtom, {
      ...alepha.store.get(dashboardAtom),
      cards,
    });
    void resolveAction.refetch();
  };

  /**
   * The card list as it stands right now, not as it was at render time.
   */
  const currentCards = () => alepha.store.get(dashboardAtom).cards;

  const reorderAction = useAction<[ids: number[]], void>(
    {
      handler: async (ids) => {
        // Optimistic: the drop already moved the tile under the reader's
        // cursor, and putting it back for the length of a round-trip would
        // read as the drag having failed.
        const byId = new Map(currentCards().map((card) => [card.id, card]));
        const next = ids.map((id) => byId.get(id)!).filter(Boolean);
        alepha.store.set(dashboardAtom, {
          ...alepha.store.get(dashboardAtom),
          cards: next,
        });
        await dashboardApi.reorderCards({ body: { ids } });
      },
      // ⚠️ Deliberately quiet, and deliberately no rollback: a failed reorder
      // keeps the new order on screen until the next load, and does not
      // toast. The order is a preference, not data anyone else reads, and a
      // tile that jumped back after the drop would read as the drag failing.
      onError: () => {},
    },
    [alepha, dashboardApi],
  );

  const removeAction = useAction<[card: DashboardCardResource], void>(
    {
      handler: async (card) => {
        const confirmed = await dialog.confirm({
          title: tr("dashboard.card.delete.confirm"),
          confirmLabel: tr("dashboard.card.delete"),
          destructive: true,
        });
        if (!confirmed) return;
        await dashboardApi.removeCard({ params: { cardId: card.id } });
        apply(currentCards().filter((it) => it.id !== card.id));
      },
    },
    [alepha, dashboardApi, dialog, tr],
  );

  const duplicateAction = useAction<[card: DashboardCardResource], void>(
    {
      handler: async (card) => {
        const made = await dashboardApi.addCard({
          body: {
            metric: card.metric,
            scope: card.scope,
            filters: card.filters,
          },
        });
        apply([...currentCards(), made]);
      },
    },
    [alepha, dashboardApi],
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
        const made = await dashboardApi.addCard({ body: input as never });
        setCatalogueOpen(false);
        apply([...currentCards(), made]);
      },
    },
    [alepha, dashboardApi],
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
        const updated = await dashboardApi.updateCard({
          params: { cardId: card.id },
          body: input as never,
        });
        setCatalogueOpen(false);
        apply(currentCards().map((it) => (it.id === card.id ? updated : it)));
      },
    },
    [alepha, dashboardApi],
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

  return (
    <div className="bg-dotted flex h-full min-h-0 w-full overflow-hidden">
      <DashboardRail />

      {/* `pt-4` puts the action row on the rail's brand line, and on the
          same line the account cluster holds on every other surface
          (`PageHeader` pins it at `top-3`). The greeting takes its
          breathing room from the row above it now, not from the top of
          the scroll area. */}
      <main className="@container flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-4 pb-10">
        <DashboardHeader
          name={displayName(auth.user, "")}
          cardCount={dashboard.cards.length}
          refreshedAt={dashboard.refreshedAt}
          onAdd={openCatalogue}
        />

        <DashboardGrid
          cards={dashboard.cards}
          values={dashboard.values}
          metrics={metrics}
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

        {dashboard.cards.length === 0 && <DashboardEmpty />}

        {/* The rail's contents, for every width the rail is not rendered at.
            `lg:hidden` is the exact complement of its `lg:flex`, which is what
            covers 768-1023 - the band where there is no rail and `useIsMobile`
            still reports desktop. See the section's own note. */}
        <DashboardProjectsSection />
      </main>

      {/*
       * Kept mounted, and re-keyed rather than mounted by a condition: the
       * drawer needs to survive `open` going false long enough to animate
       * out, and its step/scope/filter state has to start from `editing`
       * every time the panel opens for a different card. `editing` is
       * therefore left standing on close and cleared only when the panel is
       * opened afresh — clearing it on close would change the key mid-exit
       * and snap the drawer away instead of sliding it.
       */}
      <DashboardCatalogue
        key={editing?.id ?? "new"}
        open={catalogueOpen}
        board="home"
        cards={dashboard.cards}
        projects={projects}
        apps={apps}
        editing={editing}
        onClose={() => setCatalogueOpen(false)}
        onAdd={(input) => void addAction.run(input)}
        onUpdate={(card, input) => void updateAction.run(card, input)}
        busy={busy}
      />
    </div>
  );
};

export default Dashboard;
