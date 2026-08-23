import { Button } from "@alepha/ui/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@alepha/ui/components/ui/drawer";
import { Input } from "@alepha/ui/components/ui/input";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ArrowLeft, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { DashboardCardResource } from "@/api/schemas/dashboardCardResourceSchema.ts";
import type { DashboardScope } from "@/api/schemas/dashboardScopeSchema.ts";
import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";
import {
  DashboardMetricCatalog,
  type DashboardMetricDescriptor,
} from "@/api/services/DashboardMetricCatalog.ts";

import type { I18n } from "../../services/I18n.ts";
import DashboardCatalogueRow from "./DashboardCatalogueRow.tsx";
import { dashboardFilterFields } from "./dashboardFilterFields.ts";
import DashboardFilterStep from "./DashboardFilterStep.tsx";
import DashboardScopeStep, {
  type DashboardScopeApp,
} from "./DashboardScopeStep.tsx";

export interface DashboardCatalogueProps {
  open: boolean;
  cards: DashboardCardResource[];
  projects: ProjectOverviewResource[];
  apps: DashboardScopeApp[];
  /**
   * When set, the panel opens straight on the scope step for this card and
   * saves back to it instead of adding a new one. The card menu's "Change
   * scope" uses it.
   */
  editing?: DashboardCardResource;
  onClose: () => void;
  onAdd: (input: {
    metric: string;
    scope: DashboardScope;
    filters: Record<string, unknown>;
  }) => void;
  onUpdate: (
    card: DashboardCardResource,
    input: { scope: DashboardScope; filters: Record<string, unknown> },
  ) => void;
}

/**
 * The Add-card panel: metric, then scope, then that metric's own filters.
 *
 * ⚠️ **Generated from the registry, never written per tile.** Every row, every
 * picker and every filter chip here comes from a `DashboardMetricDescriptor`:
 * the label and hint are i18n keys it carries, the picker is chosen by the
 * `scopeKinds` it declares, and the filter step is read off its Zod schema.
 * Adding a metric must require no change to this file.
 *
 * A metric with nothing to scope is not offered. The mockup says as much in
 * its own footnote, and it is the honest behaviour: an app metric on an
 * account with no enrolled app would add a card that can only ever say zero.
 *
 * ## A real drawer, not an `<aside>`
 *
 * This used to be a bare flex child of the dashboard row, sliding nothing and
 * stealing width from the grid it was meant to add to — every tile reflowed
 * the moment the panel opened. It is now `@alepha/ui`'s `Drawer` on the right
 * edge, which brings the parts that were missing rather than merely the
 * animation: a focus trap, Escape and outside-press dismissal, and a
 * scroll-locked backdrop. The caller keeps this mounted and drives `open`, so
 * the panel gets its closing animation instead of vanishing.
 */
const DashboardCatalogue = (props: DashboardCatalogueProps) => {
  const { tr } = useI18n<I18n, "en">();
  const catalog = useInject(DashboardMetricCatalog);

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<DashboardMetricDescriptor | undefined>(
    props.editing ? catalog.find(props.editing.metric) : undefined,
  );
  const [scope, setScope] = useState<DashboardScope>(
    props.editing?.scope ?? { kind: "all" },
  );
  const [filters, setFilters] = useState<Record<string, unknown>>(
    props.editing?.filters ?? {},
  );

  const groups = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const byGroup = new Map<string, DashboardMetricDescriptor[]>();
    for (const metric of catalog.all()) {
      if (
        wanted &&
        !String(tr(metric.labelKey as never))
          .toLowerCase()
          .includes(wanted)
      ) {
        continue;
      }
      byGroup.set(metric.group, [...(byGroup.get(metric.group) ?? []), metric]);
    }
    return [...byGroup];
  }, [catalog, query, tr]);

  /**
   * Why a metric cannot be added right now, if it cannot.
   */
  const unavailable = (
    metric: DashboardMetricDescriptor,
  ): string | undefined => {
    if (
      metric.scopeKinds.includes("all") ||
      metric.scopeKinds.includes("projects")
    ) {
      return props.projects.length === 0
        ? "dashboard.catalogue.noProjects"
        : undefined;
    }
    const usable =
      metric.key === "uniqueVisitors"
        ? props.apps.filter((app) => app.beacon)
        : props.apps;
    return usable.length === 0 ? "dashboard.catalogue.noApps" : undefined;
  };

  const start = (metric: DashboardMetricDescriptor) => {
    setPicked(metric);
    setScope(
      metric.scopeKinds.includes("all")
        ? { kind: "all" }
        : { kind: "apps", sigilIds: [] },
    );
    setFilters(catalog.defaultFilters(metric.key));
  };

  const save = () => {
    if (!picked) return;
    if (props.editing) {
      props.onUpdate(props.editing, { scope, filters });
      return;
    }
    props.onAdd({ metric: picked.key, scope, filters });
  };

  const canSave =
    !!picked &&
    (scope.kind !== "apps" || (scope.sigilIds ?? []).length > 0) &&
    (scope.kind !== "projects" || (scope.projectIds ?? []).length > 0);

  return (
    <Drawer
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      swipeDirection="right"
    >
      <DrawerContent
        data-testid="dashboard-catalogue"
        className="bg-card sm:[--drawer-content-width:23rem]"
      >
        <DrawerHeader className="flex-row items-center gap-2 p-6 pb-3 md:text-left">
          {picked && !props.editing && (
            <button
              type="button"
              aria-label={tr("dashboard.catalogue.back")}
              onClick={() => setPicked(undefined)}
              className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded-md transition-colors"
            >
              <ArrowLeft className="size-3.5" />
            </button>
          )}
          <DrawerTitle className="cn-font-sans text-sm font-medium">
            {picked
              ? tr(picked.labelKey as never)
              : tr("dashboard.catalogue.title")}
          </DrawerTitle>
          <span className="flex-1" />
          <DrawerClose
            aria-label={tr("dashboard.catalogue.close")}
            data-testid="dashboard-catalogue-close"
            className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-6 items-center justify-center rounded-[7px] transition-colors"
          >
            <X className="size-3.5" />
          </DrawerClose>
        </DrawerHeader>

        {!picked && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={String(tr("dashboard.catalogue.filter"))}
                aria-label={String(tr("dashboard.catalogue.filter"))}
                className="bg-background h-8 rounded-lg pl-8 text-[12.5px]"
              />
            </div>

            <div className="flex flex-col">
              {groups.map(([group, metrics]) => (
                <div key={group}>
                  <div className="text-muted-foreground px-0 pt-3.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase">
                    {tr(`dashboard.group.${group}` as never)}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {metrics.map((metric) => (
                      <DashboardCatalogueRow
                        key={metric.key}
                        metric={metric}
                        onBoard={props.cards.some(
                          (card) => card.metric === metric.key,
                        )}
                        unavailableKey={unavailable(metric)}
                        onSelect={() => start(metric)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {groups.length === 0 && (
                <div className="text-muted-foreground pt-4 text-[11.5px]">
                  {tr("dashboard.catalogue.empty")}
                </div>
              )}
            </div>

            <div className="border-border text-muted-foreground mt-4 border-t pt-3.5 text-[11.5px] leading-relaxed">
              {tr("dashboard.catalogue.note")}
            </div>
          </div>
        )}

        {picked && (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-2">
              <div className="flex flex-col gap-1.5">
                <div className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.08em] uppercase">
                  {tr("dashboard.scope.pick")}
                </div>
                <DashboardScopeStep
                  metric={picked}
                  projects={props.projects}
                  apps={props.apps}
                  scope={scope}
                  onChange={setScope}
                />
              </div>

              {dashboardFilterFields(picked.filters).length > 0 && (
                <DashboardFilterStep
                  metric={picked}
                  values={filters}
                  onChange={setFilters}
                />
              )}
            </div>

            <DrawerFooter className="px-6 pt-4 pb-6">
              <Button
                onClick={save}
                disabled={!canSave}
                data-testid="dashboard-catalogue-save"
                className="h-9 rounded-[9px]"
              >
                {props.editing
                  ? tr("dashboard.catalogue.save")
                  : tr("dashboard.addCard")}
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
};

export default DashboardCatalogue;
