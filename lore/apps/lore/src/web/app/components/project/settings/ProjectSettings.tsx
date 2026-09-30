import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import {
  findSettingsTab,
  visibleSettingsTabs,
} from "./projectSettingsSections.ts";

/**
 * The settings shell: the open section's name over its tabs, and the page.
 *
 * There is no second nav rail any more (#Q2565). The sections are children of
 * the Settings entry in the project sidebar, which `ProjectView` builds from
 * the same `SETTINGS_SECTIONS` table this reads, so the two cannot disagree
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
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const activeRoute = routerState.name ?? "";

  if (!project) {
    return null;
  }

  const found = findSettingsTab(activeRoute);
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
      plate={
        found ? (
          <div className="flex flex-col gap-1 px-4 pt-4 pb-3 md:px-6">
            <h1 className="text-xl font-semibold">
              {tr(found.section.labelKey)}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr(found.section.descriptionKey)}
            </p>
          </div>
        ) : undefined
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6">
        <NestedView />
      </div>
    </PlateLayout>
  );
};

export default ProjectSettings;
