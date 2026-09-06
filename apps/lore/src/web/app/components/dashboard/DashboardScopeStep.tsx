import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { Check } from "lucide-react";

import type { DashboardScope } from "@/api/schemas/dashboardScopeSchema.ts";
import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";
import type { DashboardMetricDescriptor } from "@/api/services/DashboardMetricCatalog.ts";

import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";

/**
 * One app the reader can point a card at.
 */
export interface DashboardScopeApp {
  id: string;
  name: string;
  projectId: number;
  projectTitle: string;
  /**
   * Whether this app reports page views. Visitors cards need it.
   */
  beacon: boolean;
}

export interface DashboardScopeStepProps {
  metric: DashboardMetricDescriptor;
  projects: ProjectOverviewResource[];
  apps: DashboardScopeApp[];
  scope: DashboardScope;
  onChange: (scope: DashboardScope) => void;
}

/**
 * Step two: what the card is pointed at.
 *
 * The picker is chosen by the metric's declared `scopeKinds`, never by the
 * metric's name — `all` offers one entry, `projects` a project list, `apps` a
 * multi-select that may span projects. That last one is the hard case and the
 * reason the scope is a tagged union rather than a project id: an app list is
 * not implicitly single-project.
 *
 * ⚠️ Apps without a `beacon` capability are offered for blights and withheld
 * from visitors. A beacon-less app reports no page views at all and its
 * analytics page 404s, so a visitors card scoped to one would show a
 * permanent zero and link to an error.
 */
const DashboardScopeStep = (props: DashboardScopeStepProps) => {
  const { tr } = useI18n<I18n, "en">();
  const kinds = props.metric.scopeKinds;

  const apps =
    props.metric.key === "uniqueVisitors"
      ? props.apps.filter((app) => app.beacon)
      : props.apps;

  const selectProject = (projectId: number) =>
    props.onChange({ kind: "projects", projectIds: [projectId] });

  const toggleApp = (appId: string) => {
    const current =
      props.scope.kind === "apps" ? (props.scope.sigilIds ?? []) : [];
    const next = current.includes(appId)
      ? current.filter((id) => id !== appId)
      : [...current, appId];
    if (next.length === 0) {
      // Never leave an `apps` scope empty: it would fail validation on save
      // and the reader would have no way to see why.
      props.onChange(
        kinds.includes("all")
          ? { kind: "all" }
          : { kind: "apps", sigilIds: current },
      );
      return;
    }
    props.onChange({ kind: "apps", sigilIds: next });
  };

  const rowClass = (selected: boolean) =>
    cn(
      "border-border hover:border-muted-foreground/40 flex items-center gap-2.5 rounded-[9px] border px-2.5 py-2 text-left text-[12.5px] transition-colors",
      selected && "border-primary/60 bg-accent",
    );

  return (
    <div className="flex flex-col gap-1.5">
      {kinds.includes("all") && (
        <button
          type="button"
          data-testid="dashboard-scope-all"
          onClick={() => props.onChange({ kind: "all" })}
          className={rowClass(props.scope.kind === "all")}
        >
          <span className="flex-1">{tr("dashboard.scope.allProjects")}</span>
          {props.scope.kind === "all" && <Check className="size-3.5" />}
        </button>
      )}

      {kinds.includes("projects") &&
        props.projects.map((project) => {
          const selected =
            props.scope.kind === "projects" &&
            (props.scope.projectIds ?? []).includes(project.id);
          return (
            <button
              key={project.id}
              type="button"
              data-testid="dashboard-scope-project"
              onClick={() => selectProject(project.id)}
              className={rowClass(selected)}
            >
              <ProjectIcon fileId={project.icon} className="size-5 rounded" />
              <span className="flex-1 truncate">{project.title}</span>
              {selected && <Check className="size-3.5" />}
            </button>
          );
        })}

      {kinds.includes("apps") &&
        apps.map((app) => {
          const selected =
            props.scope.kind === "apps" &&
            (props.scope.sigilIds ?? []).includes(app.id);
          return (
            <button
              key={app.id}
              type="button"
              data-testid="dashboard-scope-app"
              onClick={() => toggleApp(app.id)}
              className={rowClass(selected)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{app.name}</span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {app.projectTitle}
                </span>
              </span>
              {selected && <Check className="size-3.5" />}
            </button>
          );
        })}

      {kinds.includes("apps") && apps.length === 0 && (
        <div className="text-muted-foreground rounded-[9px] border border-dashed px-2.5 py-3 text-[11.5px]">
          {tr("dashboard.scope.noApps")}
        </div>
      )}
    </div>
  );
};

export default DashboardScopeStep;
