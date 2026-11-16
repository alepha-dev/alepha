import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import { canInProject, currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
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
  const personaApi = useClient<PersonaController>();
  const projectId = project?.id ?? 0;

  // Each tab's count, under the key its own list reads, so the count and
  // the list are one request. Shown once resolved: `undefined` draws the
  // bare label rather than a confident "0".
  const personas = useQuery<PersonaResource[]>(
    {
      key: ["personas", projectId],
      enabled:
        projectId > 0 && !!project && canInProject(project, "persona:read"),
      handler: async () =>
        await personaApi.getPersonas({ params: { projectId }, query: {} }),
    },
    [personaApi, projectId],
  );
  const useCaseApi = useClient<UseCaseController>();
  const useCases = useQuery<UseCaseResource[]>(
    {
      key: ["use-cases", projectId],
      enabled:
        projectId > 0 && !!project && canInProject(project, "usecase:read"),
      handler: async () =>
        await useCaseApi.getUseCases({ params: { projectId }, query: {} }),
    },
    [useCaseApi, projectId],
  );
  const requirementApi = useClient<RequirementController>();
  const requirements = useQuery<RequirementResource[]>(
    {
      key: ["requirements", projectId],
      enabled:
        projectId > 0 && !!project && canInProject(project, "requirement:read"),
      handler: async () =>
        await requirementApi.getRequirements({
          params: { projectId },
          query: {},
        }),
    },
    [requirementApi, projectId],
  );
  const counts: Record<string, number | undefined> = {
    projectRequirements: requirements.data?.length,
    projectPersonas: personas.data?.length,
    projectUseCases: useCases.data?.length,
  };

  const tabs: PlateTab[] = REQUIREMENTS_TABS.filter(
    (tab) => project && canInProject(project, tab.permission),
  ).map((tab) => ({
    key: tab.route,
    label: tr(tab.labelKey),
    icon: tab.icon,
    href: router.path(tab.route),
    count: counts[tab.route],
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
