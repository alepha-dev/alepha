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
 * Reports shell: a tab strip and a `<NestedView />` rendering the active
 * child page. No plate - see the note at the `PlateLayout` call below.
 *
 * On `PlateLayout` since #1693, which is the Release view's shape lifted into
 * `@alepha/ui`. Before that this file drew its own tab row inside a
 * `max-w-5xl` column, which put the strip oddly to the right of the page it
 * belonged to and made Reports the one detail page that looked like nothing
 * else. The cap went with it: a report is a table and a chart, and both want
 * the width.
 *
 * The tab list is not a constant: Overview and Quests need Work, Quality
 * needs Apps AND a run to exist, and Members needs nothing. See
 * `reportsTabs.ts` for why an ingested tab is gated where a derived one is
 * not, and why this section is Core while its tabs are not.
 */
export interface ReportsLayoutProps {
  /**
   * Whether this project has ever received a quality run, from the loader.
   */
  hasQualityRun: boolean;
}

const ReportsLayout = (props: ReportsLayoutProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);

  const tabs: PlateTab[] = reportsTabs(project, props.hasQualityRun).map(
    (tab) => ({
      key: tab.route,
      label: String(tr(tab.labelKey)),
      // Each tab is its own route, so each is a link: middle-click, copy-link
      // and the back button all depend on it.
      href: router.path(tab.route),
    }),
  );

  return (
    <PlateLayout
      tabsTestId="reports-tabs"
      tabs={tabs}
      active={routerState.name ?? ""}
      // No plate, deliberately (feedback #2095). It printed "Reports" beside
      // the project's title, directly under a breadcrumb already reading
      // "Alepha > Reports": both words twice, a few pixels apart. Same
      // reasoning as the Activity heading in #2090.
      //
      // `AppLayout` and `ProjectRelease` keep theirs because a plate that
      // names an ENTITY - an app's address, a release's tag and progress -
      // carries what the breadcrumb leaf cannot. A plate that names the
      // section is the leaf, drawn twice.
    >
      <div className="flex flex-col gap-8 p-4">
        <NestedView />
      </div>
    </PlateLayout>
  );
};

export default ReportsLayout;
