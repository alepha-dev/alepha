import { Badge } from "@alepha/ui";
import { PlateLayout } from "@alepha/ui/shell";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import {
  ArrowLeft,
  Gauge,
  Layers,
  type LucideIcon,
  Settings,
  Terminal,
} from "lucide-react";
import { useMemo } from "react";

import { currentEstateAtom } from "@/web/app/atoms/currentEstateAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import type { AppRouter } from "../../AppRouter.ts";

/**
 * The console for one `bay` estate, as a detail page inside the account
 * shell (#E68): a header saying which machine this is and whether it is
 * connected, a bar of tabs, and the tab under them.
 *
 * The sidebar stays the account's, with Estates lit, so the way back to the
 * list is both the sidebar entry and the back link here. The tabs are
 * `PlateLayout`'s bar of LINKS, one route each, never a tablist: a tab is its
 * own URL, so middle-click, copy-link and the back button all work. Each tab
 * picks its own frame (`AccountPage`): Apps and Commands are tables that
 * fill the area, the others are columns of cards.
 *
 * ⚠️ **This is not a permission boundary.** Every route in this tree
 * resolves through `EstateService.loadOwned`, which answers 404 for anyone
 * but the owner. This decides what to draw.
 */
const BayLayout = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [estate] = useStore(currentEstateAtom);
  const estateId = estate?.id;
  // The instance page lives under Apps, so that tab stays lit while one is
  // open.
  const active =
    routerState.name === "bayApp" ? "bayApps" : (routerState.name ?? "");

  /*
    Resolved hrefs: this subtree is parameterised
    (`/account/estates/:estateId/...`), and a route PATTERN handed to a link
    renders perfectly while going nowhere.
  */
  const tabs = useMemo(
    () =>
      estateId
        ? TABS.map((tab) => ({
            key: tab.route,
            label: tr(tab.labelKey),
            icon: tab.icon,
            href: router.path(tab.route, { params: { estateId } }),
          }))
        : [],
    [estateId, router, tr],
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
          <Link
            href={router.path("accountEstates")}
            className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm transition-colors"
            data-testid="bay-back"
          >
            <ArrowLeft className="size-4" />
            {tr("bay.back")}
          </Link>
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
