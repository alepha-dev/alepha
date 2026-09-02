import { PlateLayout } from "@alepha/ui/components/plate-layout/plate-layout";
import type { PlateTab } from "@alepha/ui/components/plate-layout/plate-tab-bar";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { reportsTabs } from "./reportsTabs.ts";

/**
 * Reports shell: the project's name over a tab strip, and a `<NestedView />`
 * rendering the active child page.
 *
 * On `PlateLayout` since #1693, which is the Release view's shape lifted into
 * `@alepha/ui`. Before that this file drew its own tab row inside a
 * `max-w-5xl` column, which put the strip oddly to the right of the page it
 * belonged to and made Reports the one detail page that looked like nothing
 * else. The cap went with it: a report is a table and a chart, and both want
 * the width.
 *
 * The tab list is not a constant: Quality only exists where
 * `features.quality` is on. See `reportsTabs.ts` for why an ingested tab is
 * gated where a derived one is not.
 */
const ReportsLayout = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);

  const tabs: PlateTab[] = reportsTabs(project?.features).map((tab) => ({
    key: tab.route,
    label: String(tr(tab.labelKey)),
    // Each tab is its own route, so each is a link: middle-click, copy-link
    // and the back button all depend on it.
    href: router.path(tab.route),
  }));

  return (
    <PlateLayout
      tabsTestId="reports-tabs"
      tabs={tabs}
      active={routerState.name ?? ""}
      plate={
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 pt-6 pb-4">
          {/* The section's own name, from the sidebar entry that leads here
              rather than a second key saying the same word. */}
          <h1 className="text-xl font-semibold">
            {tr("project.menu.reports")}
          </h1>
          <span className="text-muted-foreground text-xs">
            {project?.title}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-8 p-4">
        <NestedView />
      </div>
    </PlateLayout>
  );
};

export default ReportsLayout;
