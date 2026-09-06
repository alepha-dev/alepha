import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";
import type { DashboardMetricDescriptor } from "@/api/services/DashboardMetricCatalog.ts";
import {
  capabilityOption,
  hasCapability,
} from "@/web/app/services/projectCapabilities.ts";

import type { DashboardScopeApp } from "./DashboardScopeStep.tsx";

/**
 * What the Add-card panel may offer, given what each project can answer.
 *
 * ⚠️ **The filter is per scope target, never per board.** The dashboard is
 * the reader's, not a project's: one card counts quests across every project
 * they belong to, another counts visitors on two apps in two projects. So a
 * project row is offered when THAT project has the metric's capability, an
 * app row when ITS project does, and the `all` row when any project does. A
 * single board-wide verdict would either hide a card the reader has one good
 * project for, or keep offering one that can only ever say zero.
 *
 * Module-level functions for the reason `projectCapabilities.ts` gives: these
 * are read from a component and could just as easily be read from a loader,
 * and the two must not disagree.
 *
 * The server does not trust any of this. `DashboardMetricRegistry` narrows a
 * resolved scope by the same rule before a query sees it, so a card stored
 * while a capability was on answers about the projects that still have it
 * rather than counting rows a disabled surface hides.
 */
export type DashboardEligibleProject = Pick<
  ProjectResource,
  "id" | "capabilities"
>;

/**
 * Whether one project can answer this metric.
 */
export const projectAnswers = (
  metric: DashboardMetricDescriptor,
  project: DashboardEligibleProject | undefined,
): boolean => {
  const needs = metric.needs;
  if (!needs) return true;
  if (!hasCapability(project, needs.capability)) return false;
  return (
    !needs.option || capabilityOption(project, needs.capability, needs.option)
  );
};

/**
 * The projects a `projects`-scoped card may be pointed at.
 */
export const eligibleProjects = <T extends DashboardEligibleProject>(
  metric: DashboardMetricDescriptor,
  projects: T[],
): T[] => projects.filter((project) => projectAnswers(metric, project));

/**
 * The apps an `apps`-scoped card may be pointed at.
 *
 * Two independent conditions, and both are needed: the app's PROJECT must
 * carry the capability, and the app itself must report the right kind. An app
 * whose project is unknown to the caller is dropped rather than allowed - the
 * picker only ever lists apps of visible projects, so an unmatched one is a
 * stale list, not a permission to guess.
 */
export const eligibleApps = (
  metric: DashboardMetricDescriptor,
  apps: DashboardScopeApp[],
  projects: DashboardEligibleProject[],
): DashboardScopeApp[] => {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return apps.filter(
    (app) =>
      (!metric.needsBeacon || app.beacon) &&
      projectAnswers(metric, byId.get(app.projectId)),
  );
};

/**
 * Why a metric cannot be added right now, if it cannot: an i18n key, or
 * `undefined` when there is at least one target for it.
 *
 * The two messages are about different absences and both already existed.
 * What is new is that "no project" now means "no project that does this",
 * which is the same sentence from the reader's side: a Knowledge-only
 * account has projects and none of them has a quest to count.
 */
export const metricUnavailableKey = (
  metric: DashboardMetricDescriptor,
  projects: DashboardEligibleProject[],
  apps: DashboardScopeApp[],
):
  | "dashboard.catalogue.noProjects"
  | "dashboard.catalogue.noApps"
  | undefined => {
  if (
    metric.scopeKinds.includes("all") ||
    metric.scopeKinds.includes("projects")
  ) {
    return eligibleProjects(metric, projects).length === 0
      ? "dashboard.catalogue.noProjects"
      : undefined;
  }
  return eligibleApps(metric, apps, projects).length === 0
    ? "dashboard.catalogue.noApps"
    : undefined;
};
