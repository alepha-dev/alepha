import { SettingsLayout } from "@alepha/ui/components/settings/settings-layout";
import {
  SettingsNav,
  type SettingsNavItem,
} from "@alepha/ui/components/settings/settings-nav";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import {
  Gauge,
  Layers,
  type LucideIcon,
  Settings,
  Terminal,
} from "lucide-react";
import { createElement, useMemo } from "react";

import { currentEstateAtom } from "@/web/app/atoms/currentEstateAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import type { AppRouter } from "../../AppRouter.ts";

/**
 * The console for one `bay` estate.
 *
 * The shell only: the header saying which machine this is and whether it is
 * connected, and the rail. Everything else is a tab under it.
 *
 * ⚠️ **A drawer is not a permission boundary, and neither is this.** Every
 * route in this tree resolves through `EstateService.loadOwned`, which
 * answers 404 for anyone but the owner. This decides what to draw.
 */
const BayLayout = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [estate] = useStore(currentEstateAtom);
  const estateId = estate?.id;
  const activeRoute = routerState.name ?? "";

  /*
    Resolved hrefs, built here rather than left to `SettingsNav`. That is the
    documented contract and the reason `ProjectSettings.tsx` does the same:
    this subtree is parameterised (`/bay/:estateId/...`), and `useNavEntries`
    would hand back the raw route PATTERN, so every link in the rail would
    carry a literal `:estateId` and render perfectly while going nowhere.
  */
  const items = useMemo<SettingsNavItem[]>(
    () =>
      estateId
        ? NAV_ITEMS.map((item) => ({
            name: item.route,
            href: router.path(item.route, { params: { estateId } }),
            label: tr(item.labelKey),
            icon: createElement(item.icon),
            // The instance page lives under Apps, so the entry stays lit
            // while one is open.
            active:
              activeRoute === item.route ||
              (item.route === "bayApps" && activeRoute === "bayApp"),
          }))
        : [],
    [estateId, activeRoute, router, tr],
  );

  if (!estate) {
    return null;
  }

  return (
    <SettingsLayout
      className="max-w-6xl"
      nav={<SettingsNav items={items} size="default" />}
      header={
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
      }
    >
      <NestedView />
    </SettingsLayout>
  );
};

export default BayLayout;

interface BayNavItem {
  route: "bayOverview" | "bayApps" | "bayCommands" | "baySettings";
  labelKey: Parameters<ReturnType<typeof useI18n<I18n, "en">>["tr"]>[0];
  icon: LucideIcon;
}

/**
 * The rail, as data.
 *
 * ⚠️ Every name here is passed to `router.path` as a plain string, which the
 * type system does not tie to the route table. `test/app-routes.spec.ts`
 * resolves each one, which is what turns a rename into a red test rather than
 * a throw in production.
 */
const NAV_ITEMS: BayNavItem[] = [
  { route: "bayOverview", labelKey: "bay.nav.overview", icon: Gauge },
  { route: "bayApps", labelKey: "bay.nav.apps", icon: Layers },
  { route: "bayCommands", labelKey: "bay.nav.commands", icon: Terminal },
  { route: "baySettings", labelKey: "bay.nav.settings", icon: Settings },
];
