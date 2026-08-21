import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useMemo, useState } from "react";
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
  const [apps, setApps] = useState<DashboardScopeApp[]>([]);

  const projects = overview?.projects ?? [];
  const metrics = useMemo(
    () => new Map(catalog.all().map((metric) => [metric.key, metric])),
    [catalog],
  );

  const resolve = async (cards: DashboardCardResource[]) => {
    if (cards.length === 0) {
      alepha.store.set(dashboardAtom, { cards, values: [] });
      return;
    }
    const resolved = await dashboardApi
      .resolveCards({ body: {} })
      .catch(() => undefined);
    alepha.store.set(dashboardAtom, {
      cards,
      values: resolved?.values ?? [],
      refreshedAt: resolved?.refreshedAt,
    });
  };

  // One resolve per mount. `dashboard.cards` is deliberately NOT in the
  // dependency list: every mutation below re-resolves explicitly, and keying
  // this on state the same effect writes is precisely how a loader turns into
  // a request loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    void resolve(alepha.store.get(dashboardAtom).cards);
  }, []);

  /**
   * The apps the scope picker can offer, across every project.
   *
   * One request per project, and only when the panel opens: a card list with
   * no app-scoped metric never needs them, and the landing page must not pay
   * for a picker nobody opened. Failures cost the picker its options, never
   * the page.
   */
  useEffect(() => {
    if (!catalogueOpen || apps.length > 0 || projects.length === 0) return;
    let cancelled = false;
    Promise.all(
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
          .catch(() => []),
      ),
    ).then((lists) => {
      if (!cancelled) setApps(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [catalogueOpen, projects.length]);

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
    void resolve(cards);
  };

  /** The card list as it stands right now, not as it was at render time. */
  const currentCards = () => alepha.store.get(dashboardAtom).cards;

  const onReorder = async (ids: number[]) => {
    // Optimistic: the drop already moved the tile under the reader's cursor,
    // and putting it back for the length of a round-trip would read as the
    // drag having failed.
    const byId = new Map(currentCards().map((card) => [card.id, card]));
    const next = ids.map((id) => byId.get(id)!).filter(Boolean);
    alepha.store.set(dashboardAtom, {
      ...alepha.store.get(dashboardAtom),
      cards: next,
    });
    await dashboardApi.reorderCards({ body: { ids } }).catch(() => undefined);
  };

  const onRemove = async (card: DashboardCardResource) => {
    const confirmed = await dialog.confirm({
      title: String(tr("dashboard.card.delete.confirm")),
      confirmLabel: String(tr("dashboard.card.delete")),
      destructive: true,
    });
    if (!confirmed) return;
    await dashboardApi.removeCard({ params: { cardId: card.id } });
    apply(currentCards().filter((it) => it.id !== card.id));
  };

  const onDuplicate = async (card: DashboardCardResource) => {
    const made = await dashboardApi.addCard({
      body: { metric: card.metric, scope: card.scope, filters: card.filters },
    });
    apply([...currentCards(), made]);
  };

  const onReset = async () => {
    const confirmed = await dialog.confirm({
      title: String(tr("dashboard.reset.confirm.title")),
      description: String(tr("dashboard.reset.confirm.description")),
      confirmLabel: String(tr("dashboard.reset")),
    });
    if (!confirmed) return;
    const res = await dashboardApi.resetLayout({});
    apply(res.cards);
  };

  const onAdd = async (input: {
    metric: string;
    scope: DashboardScope;
    filters: Record<string, unknown>;
  }) => {
    const made = await dashboardApi.addCard({ body: input as never });
    setCatalogueOpen(false);
    apply([...currentCards(), made]);
  };

  const onUpdate = async (
    card: DashboardCardResource,
    input: { scope: DashboardScope; filters: Record<string, unknown> },
  ) => {
    const updated = await dashboardApi.updateCard({
      params: { cardId: card.id },
      body: input as never,
    });
    setCatalogueOpen(false);
    apply(currentCards().map((it) => (it.id === card.id ? updated : it)));
  };

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
      <main className="@container flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pb-10 pt-4">
        <DashboardHeader
          name={displayName(auth.user, "")}
          cardCount={dashboard.cards.length}
          refreshedAt={dashboard.refreshedAt}
          onReset={onReset}
          onAdd={openCatalogue}
        />

        <DashboardGrid
          cards={dashboard.cards}
          values={dashboard.values}
          metrics={metrics}
          onReorder={onReorder}
          onAdd={openCatalogue}
          onChangeScope={(card) => {
            setEditing(card);
            setCatalogueOpen(true);
          }}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />

        {dashboard.cards.length === 0 && <DashboardEmpty />}
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
        cards={dashboard.cards}
        projects={projects}
        apps={apps}
        editing={editing}
        onClose={() => setCatalogueOpen(false)}
        onAdd={onAdd}
        onUpdate={onUpdate}
      />
    </div>
  );
};

export default Dashboard;
