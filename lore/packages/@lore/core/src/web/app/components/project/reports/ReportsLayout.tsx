import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

import type { ReportsUrl } from "../../../../../api/schemas/reportsUrlSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { ReportsTabRegistry } from "../../../registries/ReportsTabRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import ReportsFilterBar from "./ReportsFilterBar.tsx";

/**
 * Reports shell: a tab strip, the filter bar every tab shares (#Q2996) and a
 * `<NestedView />` rendering the active child page. No plate - see the note at the `PlateLayout` call below.
 *
 * On `PlateLayout` since #1693, which is the Release view's shape lifted into
 * `@alepha/ui`. Before that this file drew its own tab row inside a
 * `max-w-5xl` column, which put the strip oddly to the right of the page it
 * belonged to and made Reports the one detail page that looked like nothing
 * else. The cap went with it: a report is a table and a chart, and both want
 * the width.
 *
 * The tab list is not a constant: each module registers its own tabs on
 * `ReportsTabRegistry` (#E75, #Q2611), each with its gate. See the registry for
 * why this section is Core while its tabs are not.
 */
export interface ReportsLayoutProps {
  /**
   * The page query, which the bar edits and every tab's link carries.
   */
  query: ReportsUrl;
}

const ReportsLayout = (props: ReportsLayoutProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const registry = useInject(ReportsTabRegistry);

  const registered = registry.tabs(project);
  const active = registered.find((tab) => tab.route === routerState.name);
  const search = new URLSearchParams(
    props.query as Record<string, string>,
  ).toString();

  const tabs: PlateTab[] = registered.map((tab) => ({
    key: tab.route,
    label: tr(tab.labelKey),
    icon: tab.icon,
    // Each tab is its own route, so each is a link: middle-click, copy-link
    // and the back button all depend on it. It carries the query, so moving
    // between tabs keeps the period and the filters.
    href: router.path(tab.route, { query: props.query }),
    // Each report is a heavy, pure read: `prefetch: true` on its page lets the
    // hover start it, and the click paints with no request.
    prefetch: "hover",
  }));

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
      //
      // `scroll={false}`: the filter bar sits between the tabs and the
      // report's own scroll region (#Q3606), so it stays put while a long
      // report scrolls, and a bar wrapped onto several lines pushes the
      // report down rather than covering its first chart.
      scroll={false}
    >
      <ReportsFilterBar key={search} url={props.query} />
      <div
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region must take focus for the keyboard to scroll it (WCAG 2.1.1), as PlateLayout's own does
        tabIndex={0}
        className="focus-visible:ring-ring/50 min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <div className="flex flex-col gap-8 p-4">
          {active?.descriptionKey ? (
            <p className="text-muted-foreground text-sm">
              {tr(active.descriptionKey)}
            </p>
          ) : null}
          <NestedView />
        </div>
      </div>
    </PlateLayout>
  );
};

export default ReportsLayout;
