import { cn } from "@alepha/ui/lib/utils";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Link,
  NestedView,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import {
  BookMarked,
  BookOpen,
  Flag,
  Inbox,
  KanbanSquare,
  Layers,
  type LucideIcon,
  MapPin,
  Stamp,
  Swords,
  Users,
} from "lucide-react";
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
  | "projectSettingsMilestones"
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
  | "project.settings.nav.milestones"
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
        route: "projectSettingsMilestones",
        labelKey: "project.settings.nav.milestones",
        icon: BookMarked,
      },
    ],
  },
];

const ProjectSettings = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  if (!project) {
    return null;
  }

  const projectSlug = project.slug;
  const activeRoute = routerState.name ?? "";

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:pt-10">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav className="flex shrink-0 flex-col gap-4 md:sticky md:top-0 md:w-48 md:self-start">
          {NAV_GROUPS.map((group, groupIdx) => (
            <div
              key={group.labelKey ?? `group-${groupIdx}`}
              className="flex flex-col gap-1"
            >
              {group.labelKey && (
                <span className="text-muted-foreground px-3 text-[11px] font-semibold uppercase tracking-wider">
                  {tr(group.labelKey)}
                </span>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeRoute === item.route;
                const href = router.path(item.route, {
                  params: { projectSlug },
                });
                return (
                  <Link
                    key={item.route}
                    href={href}
                    className={cn(
                      "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-muted font-medium"
                        : "text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <Icon className="size-4" />
                    {tr(item.labelKey)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <NestedView />
        </div>
      </div>
    </div>
  );
};

export default ProjectSettings;
