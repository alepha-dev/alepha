import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

import { REQUIREMENTS_TABS } from "./requirementsTabs.ts";

/**
 * The Requirements page (#E153): folder tabs over a `<NestedView />`, as
 * Reports draws them (`ReportsLayout`), and no plate (answer 73): the
 * breadcrumb already reads "Acme › Requirements", so a plate naming the
 * section would print the leaf twice. Nothing sits above the tabs; each tab
 * owns its search, filters, counters and buttons.
 *
 * A tab whose permission the reader lacks is not drawn. Each tab is a route,
 * so each is a link: never a cookie or a `?view=` switch.
 */
const RequirementsLayout = () => {
  const { tr } = useI18n<I18n, "en">();
  // A route name from this package's own constant, typed as a string:
  // the router's page names are checked where they are literals.
  const router = useRouter<any>();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);

  const tabs: PlateTab[] = REQUIREMENTS_TABS.filter(
    (tab) => project && canInProject(project, tab.permission),
  ).map((tab) => ({
    key: tab.route,
    label: tr(tab.labelKey),
    icon: tab.icon,
    href: router.path(tab.route),
  }));

  return (
    <PlateLayout
      tabsTestId="requirements-tabs"
      tabs={tabs}
      active={routerState.name ?? ""}
      // Each tab owns its scroll, below its own toolbar.
      scroll={false}
    >
      <NestedView />
    </PlateLayout>
  );
};

export default RequirementsLayout;
