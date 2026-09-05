import { SettingsLayout } from "@alepha/ui/components/settings/settings-layout";
import {
  SettingsNav,
  type SettingsNavItem,
} from "@alepha/ui/components/settings/settings-nav";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import {
  BookMarked,
  BookOpen,
  Flag,
  Gauge,
  Inbox,
  KanbanSquare,
  Layers,
  type LucideIcon,
  MapPin,
  Server,
  Stamp,
  Swords,
  Users,
} from "lucide-react";
import { createElement, useMemo } from "react";

import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

type RouteName =
  | "projectSettingsBanner"
  | "projectSettingsMembers"
  | "projectSettingsAreas"
  | "projectSettingsKanban"
  | "projectSettingsFolios"
  | "projectSettingsEpics"
  | "projectSettingsFeedback"
  | "projectSettingsSigils"
  | "projectSettingsEstates"
  | "projectSettingsReleases"
  | "projectSettingsQuality"
  | "projectSettingsQuests";

type NavLabelKey =
  | "project.settings.nav.banner"
  | "project.settings.nav.members"
  | "project.settings.nav.areas"
  | "project.settings.nav.kanban"
  | "project.settings.nav.folios"
  | "project.settings.nav.epics"
  | "project.settings.nav.feedback"
  | "project.settings.nav.sigils"
  | "project.settings.nav.estates"
  | "project.settings.nav.releases"
  | "project.settings.nav.quality"
  | "project.settings.nav.quests";

type NavGroupLabelKey = "project.settings.nav.group.features";

interface NavItem {
  route: RouteName;
  labelKey: NavLabelKey;
  icon: LucideIcon;
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
      },
      {
        route: "projectSettingsMembers",
        labelKey: "project.settings.nav.members",
        icon: Users,
      },
    ],
  },
  {
    labelKey: "project.settings.nav.group.features",
    items: [
      {
        route: "projectSettingsQuests",
        labelKey: "project.settings.nav.quests",
        icon: Swords,
      },
      {
        route: "projectSettingsKanban",
        labelKey: "project.settings.nav.kanban",
        icon: KanbanSquare,
      },
      {
        route: "projectSettingsFolios",
        labelKey: "project.settings.nav.folios",
        icon: BookOpen,
      },
      {
        route: "projectSettingsEpics",
        labelKey: "project.settings.nav.epics",
        icon: Layers,
      },
      {
        route: "projectSettingsFeedback",
        labelKey: "project.settings.nav.feedback",
        icon: Inbox,
      },
      {
        route: "projectSettingsSigils",
        labelKey: "project.settings.nav.sigils",
        icon: Stamp,
      },
      {
        route: "projectSettingsEstates",
        labelKey: "project.settings.nav.estates",
        icon: Server,
      },
      {
        route: "projectSettingsReleases",
        labelKey: "project.settings.nav.releases",
        icon: BookMarked,
      },
      {
        route: "projectSettingsQuality",
        labelKey: "project.settings.nav.quality",
        icon: Gauge,
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
            group.items.map((item) => ({
              name: item.route,
              href: router.path(item.route, { params: { projectSlug } }),
              label: tr(item.labelKey),
              icon: createElement(item.icon),
              group: group.labelKey ? String(tr(group.labelKey)) : undefined,
              active: activeRoute === item.route,
            })),
          )
        : [],
    [projectSlug, activeRoute, router, tr],
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
