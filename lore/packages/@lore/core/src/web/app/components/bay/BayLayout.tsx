import { Badge, cn, textLinkUnderlineClassName } from "@alepha/ui";
import { PlateLayout } from "@alepha/ui/shell";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import { useMemo } from "react";

import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { HostConsoleRegistry } from "../../registries/HostConsoleRegistry.ts";
import { type I18n } from "../../services/I18n.ts";
import { SubscriptionBell } from "../shared/SubscriptionBell.tsx";

/**
 * The console for one `bay` host, a page of its home project (#E126): a
 * header saying which machine this is and whether it is connected, a bar of
 * tabs, and the tab under them.
 *
 * The way back is the link to the project's Settings ▸ Apps ▸ Hosts list,
 * where every host of the project is. The tabs are
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
  const [host] = useStore(currentHostAtom);
  const hostSlug = host?.slug;
  // ⚠️ Passed explicitly on every link: the console is a page of its HOME
  // project, and a link that leaves `projectSlug` to the router renders the
  // literal `:projectSlug` from a page that does not carry it.
  const projectSlug = host?.project?.slug ?? "";
  // Core's tabs and every module's (#E166): Ship's Processes, with its
  // instance page keeping it lit, only while Ship is on.
  const [project] = useStore(currentProjectAtom);
  const consoleTabs = useInject(HostConsoleRegistry).tabs(project);
  const active = useInject(HostConsoleRegistry).activeTab(
    project,
    routerState.name ?? "",
  );

  /*
    Resolved hrefs: this subtree is parameterised
    (`/:projectSlug/hosts/:hostSlug/...`), and a route PATTERN handed to a link
    renders perfectly while going nowhere.
  */
  const tabs = useMemo(
    () =>
      hostSlug
        ? consoleTabs.map((tab) => ({
            key: tab.route,
            label: tr(tab.labelKey as Parameters<typeof tr>[0]),
            icon: tab.icon,
            // A registry supplies the names, so the router is untyped here.
            href: (router as ReturnType<typeof useRouter<any>>).path(
              tab.route,
              {
                params: { projectSlug, hostSlug },
              },
            ),
          }))
        : [],
    [consoleTabs, projectSlug, hostSlug, router, tr],
  );

  if (!host) {
    return null;
  }

  return (
    <PlateLayout
      // "Settings" and "Processes" are ordinary words the tab bodies print too.
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
            <h1 className="text-xl font-semibold">{host.slug}</h1>
            {host.label && (
              <span className="text-muted-foreground text-sm">
                {host.label}
              </span>
            )}
            <Badge variant={host.online ? "default" : "outline"}>
              {host.online ? tr("hosts.online") : tr("hosts.offline")}
            </Badge>
            {/* This host's alerts (#Q3627, #Q3733): past its TTL, its token
                invalid, offline and back, scoped to it. */}
            <div className="ms-auto">
              <SubscriptionBell
                events={[
                  "host.credential_invalid",
                  "host.expired",
                  "host.offline",
                  "host.online",
                ]}
                filter={host.id}
                label={tr("hosts.subscription.label")}
                description={tr("hosts.subscription.description")}
                offDescription={tr("hosts.subscription.offDescription")}
                testId="host-subscription-bell"
              />
            </div>
            {/* The home project, whose members manage the host (#E126). */}
            {host.project && (
              <span
                className="text-muted-foreground text-sm"
                data-testid="bay-home"
              >
                {host.project.slug ? (
                  <Link
                    href={router.path("projectSettingsHosts", {
                      params: { projectSlug: host.project.slug },
                    })}
                    className={cn(
                      textLinkUnderlineClassName,
                      "hover:text-foreground",
                    )}
                  >
                    {tr("bay.home", { args: [host.project.title] })}
                  </Link>
                ) : (
                  tr("bay.home", { args: [host.project.title] })
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
