import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { ProjectShellRegistry } from "../../../registries/ProjectShellRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import { visibleSettingsTabs } from "./projectSettingsSections.ts";

/**
 * The settings shell: the open section's tabs, and the page.
 *
 * No plate (#Q3607): the breadcrumb and the sidebar's Settings group already
 * name the section, so a title over the tabs was the leaf drawn twice, the
 * reasoning that took the Reports plate away (feedback #2095).
 *
 * There is no second nav rail any more (#Q2565). The sections are children of
 * the Settings entry in the project sidebar, which `ProjectView` builds from
 * the same `ProjectShellRegistry` sections this reads, so the two cannot disagree
 * about what a section holds. A section's pages are tabs here, links rather
 * than state, so back, copy-link and middle-click all work - the Reports
 * pattern.
 *
 * Full width (`ROUTES_FULL_WIDTH`), with the body capped at a readable
 * measure: the ranks matrix and the areas table want the room, a column of
 * switches does not.
 */
const ProjectSettings = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const shell = useInject(ProjectShellRegistry);
  const activeRoute = routerState.name ?? "";

  if (!project) {
    return null;
  }

  const found = shell.findSettingsTab(activeRoute);
  const tabs: PlateTab[] = found
    ? visibleSettingsTabs(found.section, project).map((tab) => ({
        key: tab.route,
        label: tr(tab.labelKey),
        href: router.path(tab.route, {
          params: { projectSlug: project.slug },
        }),
      }))
    : [];

  return (
    <PlateLayout
      tabsTestId="settings-tabs"
      tabs={tabs}
      active={found?.tab.route ?? activeRoute}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6">
        <NestedView />
      </div>
    </PlateLayout>
  );
};

export default ProjectSettings;
