import { Badge } from "@alepha/ui";
import { PlateLayout } from "@alepha/ui/shell";
import type { I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import {
  Gauge,
  Layers,
  type LucideIcon,
  Settings,
  Terminal,
} from "lucide-react";
import { useMemo } from "react";

import { currentEstateAtom } from "../../atoms/currentEstateAtom.ts";

/**
 * The console for one `bay` estate, a page of its home project (#E126): a
 * header saying which machine this is and whether it is connected, a bar of
 * tabs, and the tab under them.
 *
 * The way back is the link to the project's Settings ▸ Apps ▸ Estates list,
 * where every estate of the project is. The tabs are
 * `PlateLayout`'s bar of LINKS, one route each, never a tablist: a tab is its
 * own URL, so middle-click, copy-link and the back button all work. Each tab
 * picks its own frame (`AccountPage`): Apps and Commands are tables that
 * fill the area, the others are columns of cards.
 *
 * ⚠️ **This is not a permission boundary.** Every route in this tree
 * resolves through the home project's gate, which refuses anyone who is not
 * a member there; what a member may do is their rank's, carried as `can`.
 * This decides what to draw.
 */
const BayLayout = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const routerState = useRouterState();
  const [estate] = useStore(currentEstateAtom);
  const estateSlug = estate?.slug;
  // ⚠️ Passed explicitly on every link: the console is a page of its HOME
  // project, and a link that leaves `projectSlug` to the router renders the
  // literal `:projectSlug` from a page that does not carry it.
  const projectSlug = estate?.project?.slug ?? "";
  // The instance page lives under Apps, so that tab stays lit while one is
  // open.
  const active =
    routerState.name === "bayApp" ? "bayApps" : (routerState.name ?? "");

  /*
    Resolved hrefs: this subtree is parameterised
    (`/:projectSlug/estates/:estateSlug/...`), and a route PATTERN handed to a link
    renders perfectly while going nowhere.
  */
  const tabs = useMemo(
    () =>
      estateSlug
        ? TABS.map((tab) => ({
            key: tab.route,
            label: tr(tab.labelKey),
            icon: tab.icon,
            href: router.path(tab.route, {
              params: { projectSlug, estateSlug },
            }),
          }))
        : [],
    [projectSlug, estateSlug, router, tr],
  );

  if (!estate) {
    return null;
  }

  return (
    <PlateLayout
      // "Settings" and "Apps" are ordinary words the tab bodies print too.
      tabsTestId="bay-tabs"
      tabs={tabs}
      active={active}
      // Every tab frames itself with `AccountPage`: a table page bounds its
      // own body, a form page scrolls its own column. A scroll region here
      // would give a table a height to grow past instead of one to fill.
      scroll={false}
      plate={
        <div className="flex flex-col gap-2 px-4 pt-3 pb-3 md:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">{estate.slug}</h1>
            {estate.label && (
              <span className="text-muted-foreground text-sm">
                {estate.label}
              </span>
            )}
            <Badge variant={estate.online ? "default" : "outline"}>
              {estate.online ? tr("estates.online") : tr("estates.offline")}
            </Badge>
            {/* The home project, whose members manage the estate (#E126). */}
            {estate.project && (
              <span
                className="text-muted-foreground text-sm"
                data-testid="bay-home"
              >
                {estate.project.slug ? (
                  <Link
                    href={router.path("projectSettingsEstates", {
                      params: { projectSlug: estate.project.slug },
                    })}
                    className="hover:text-foreground underline-offset-4 hover:underline"
                  >
                    {tr("bay.home", { args: [estate.project.title] })}
                  </Link>
                ) : (
                  tr("bay.home", { args: [estate.project.title] })
                )}
              </span>
            )}
          </div>
        </div>
      }
    >
      <NestedView />
    </PlateLayout>
  );
};

export default BayLayout;

interface BayTab {
  route: "bayOverview" | "bayApps" | "bayCommands" | "baySettings";
  labelKey: Parameters<ReturnType<typeof useI18n<I18n, "en">>["tr"]>[0];
  icon: LucideIcon;
}

/**
 * The tabs, as data.
 *
 * ⚠️ Every name here is passed to `router.path` as a plain string, which the
 * type system does not tie to the route table. `test/app-routes.spec.ts`
 * resolves each one, which is what turns a rename into a red test rather than
 * a throw in production.
 */
const TABS: BayTab[] = [
  { route: "bayOverview", labelKey: "bay.nav.overview", icon: Gauge },
  { route: "bayApps", labelKey: "bay.nav.apps", icon: Layers },
  { route: "bayCommands", labelKey: "bay.nav.commands", icon: Terminal },
  { route: "baySettings", labelKey: "bay.nav.settings", icon: Settings },
];
