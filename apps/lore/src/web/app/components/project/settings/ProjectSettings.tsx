import { SettingsLayout } from "@alepha/ui/components/settings/settings-layout";
import {
  SettingsNav,
  type SettingsNavItem,
} from "@alepha/ui/components/settings/settings-nav";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import {
  BookOpen,
  Flag,
  Inbox,
  type LucideIcon,
  MapPin,
  Server,
  Stamp,
  Swords,
  Users,
} from "lucide-react";
import { createElement, useMemo } from "react";

import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import { hasCapability } from "@/web/app/services/projectCapabilities.ts";

type RouteName =
  | "projectSettingsBanner"
  | "projectSettingsMembers"
  | "projectSettingsAreas"
  | "projectSettingsWork"
  | "projectSettingsKnowledge"
  | "projectSettingsApps"
  | "projectSettingsSupport"
  | "projectSettingsEstates";

type NavLabelKey =
  | "project.settings.nav.banner"
  | "project.settings.nav.members"
  | "project.settings.nav.areas"
  | "project.settings.nav.estates"
  | "project.capability.work.label"
  | "project.capability.knowledge.label"
  | "project.capability.apps.label"
  | "project.capability.support.label";

type NavGroupLabelKey = "project.settings.nav.group.capabilities";

interface NavItem {
  route: RouteName;
  labelKey: NavLabelKey;
  icon: LucideIcon;
  /**
   * Hidden when this capability is off.
   *
   * Only Areas has one: a quest carries an area and a blight forwards into
   * one, so the page serves Work and has nothing to say without it. The four
   * capability pages themselves are always listed - a page you cannot reach
   * is a capability you cannot turn back on.
   */
  needs?: CapabilityKey;
}

interface NavGroup {
  labelKey?: NavGroupLabelKey;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        route: "projectSettingsBanner",
        labelKey: "project.settings.nav.banner",
        icon: Flag,
      },
      {
        route: "projectSettingsAreas",
        labelKey: "project.settings.nav.areas",
        icon: MapPin,
        needs: "work",
      },
      {
        route: "projectSettingsMembers",
        labelKey: "project.settings.nav.members",
        icon: Users,
      },
      {
        // ⚠️ Its own entry, outside the four, and it stays that way. An
        // estate is owned by a user and LENT to a project, so this page lists
        // what it holds and says so when empty. Folding it under Apps would
        // hide a lent estate from a project with no sigils, which is exactly
        // the project that needs to see it.
        route: "projectSettingsEstates",
        labelKey: "project.settings.nav.estates",
        icon: Server,
      },
    ],
  },
  {
    // Was "Features", which named the storage rather than the thing. Nine
    // pages, four of them a single switch.
    labelKey: "project.settings.nav.group.capabilities",
    items: [
      {
        route: "projectSettingsWork",
        labelKey: "project.capability.work.label",
        icon: Swords,
      },
      {
        route: "projectSettingsKnowledge",
        labelKey: "project.capability.knowledge.label",
        icon: BookOpen,
      },
      {
        route: "projectSettingsApps",
        labelKey: "project.capability.apps.label",
        icon: Stamp,
      },
      {
        route: "projectSettingsSupport",
        labelKey: "project.capability.support.label",
        icon: Inbox,
      },
    ],
  },
];

const ProjectSettings = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const projectSlug = project?.slug;
  const activeRoute = routerState.name ?? "";

  /*
    Resolved hrefs, built here rather than left to `SettingsNav`. That is the
    documented contract: this subtree is parameterised
    (`/:projectSlug/settings/...`), and `useNavEntries` would hand back the raw
    route *pattern*, so every link in the rail would carry a literal
    `:projectSlug` and render perfectly while going nowhere. `/account/*` is
    static and can pass its entries straight through; this one cannot.
  */
  const items = useMemo<SettingsNavItem[]>(
    () =>
      projectSlug
        ? NAV_GROUPS.flatMap((group) =>
            group.items
              .filter(
                (item) => !item.needs || hasCapability(project, item.needs),
              )
              .map((item) => ({
                name: item.route,
                href: router.path(item.route, { params: { projectSlug } }),
                label: tr(item.labelKey),
                icon: createElement(item.icon),
                group: group.labelKey ? String(tr(group.labelKey)) : undefined,
                active: activeRoute === item.route,
              })),
          )
        : [],
    [project, projectSlug, activeRoute, router, tr],
  );

  if (!project) {
    return null;
  }

  return (
    // `max-w-6xl` overrides the layout's own `max-w-5xl` (`cn` is tailwind-
    // merge, so the later class wins). Project settings hold wider content
    // than the account pages do: the quests and sigils screens are tables.
    <SettingsLayout
      className="max-w-6xl"
      nav={<SettingsNav items={items} size="default" />}
    >
      <NestedView />
    </SettingsLayout>
  );
};

export default ProjectSettings;
