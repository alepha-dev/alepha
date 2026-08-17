import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@alepha/ui/components/ui/sidebar";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Check, ChevronsUpDown, Home, LayoutGrid, Plus } from "lucide-react";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import { RECENT_PROJECTS_CAP } from "./recentProjectsCap.ts";

const ProjectSwitcher = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [overview] = useStore(userProjectsAtom);

  if (!project) {
    return null;
  }

  const projects = overview?.projects ?? [];
  const canCreate = overview?.canCreate ?? true;
  const maxProjects = overview?.maxProjects;
  // The five most recently updated, matching Home — NOT the first five
  // alphabetically. This list used to be sorted by title, which is right for a
  // complete list (you scan it for a name you know) and wrong for a truncated
  // one: capping an alphabetical sort answers "which five come first in the
  // alphabet", a question nobody asked, and hides everything from S onwards
  // forever.
  const byRecency = [...projects].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );
  const recent = byRecency.slice(0, RECENT_PROJECTS_CAP);
  // The project you are LOOKING AT has to be in the menu, or the switcher
  // shows no checkmark and reads as though you are nowhere. `updatedAt` moves
  // when a project is edited, not when it is visited, so an old project you
  // are actively browsing genuinely can sit outside the top five. Swap it in
  // for the least-recent of them rather than appending, so the cap stays five.
  if (!recent.some((it) => it.id === project.id)) {
    const current = byRecency.find((it) => it.id === project.id);
    if (current) recent.splice(RECENT_PROJECTS_CAP - 1, 1, current);
  }
  const hasMore = projects.length > recent.length;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="project-switcher"
            render={
              <SidebarMenuButton
                size="lg"
                className="border border-sidebar-border bg-background text-foreground hover:bg-background hover:text-foreground data-[state=open]:bg-background data-[state=open]:text-foreground"
              />
            }
          >
            <ProjectIcon fileId={project.icon} className="size-8 rounded-lg" />
            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">{project.title}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={4}
            // No width class here on purpose: `DropdownMenuContent` already
            // carries `w-(--anchor-width)`, and since `cn()` is tailwind-merge
            // any `w-*` passed in REPLACES it. This used to pass
            // `w-(--radix-dropdown-menu-trigger-width)` — a variable nothing in
            // this codebase defines — which silently overrode the working
            // anchor width and left the menu on `min-w-56` alone.
            className="min-w-56"
          >
            <DropdownMenuItem render={<Link href={router.path("home")} />}>
              <Home className="size-4" />
              {tr("home.nav")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {recent.map((c) => {
              const isActive = c.id === project.id;
              return (
                <DropdownMenuItem
                  key={c.id}
                  // A real anchor, like every other entry in this menu — an
                  // `onClick` that calls `router.push` navigates on a plain
                  // click and does nothing else, so shift/⌘/middle-click could
                  // not open a project in a new tab, the browser showed no
                  // target URL on hover, and "copy link address" was absent.
                  // Clicking the active project now re-enters its own route
                  // instead of no-opping, which is what an anchor to the page
                  // you are on does everywhere else (Lore feedback #61).
                  render={
                    <Link
                      href={router.path("project", {
                        params: { projectSlug: c.slug },
                      })}
                    />
                  }
                >
                  <ProjectIcon fileId={c.icon} className="size-6" />
                  <span className="flex-1 truncate">{c.title}</span>
                  {isActive && <Check className="size-4" />}
                </DropdownMenuItem>
              );
            })}
            {hasMore && (
              <DropdownMenuItem
                data-testid="switcher-all-projects"
                render={<Link href={router.path("accountProjects")} />}
              >
                <LayoutGrid className="size-4" />
                {tr("account.projects.see-all")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {canCreate ? (
              <DropdownMenuItem
                render={<Link href={router.path("projectCreate")} />}
              >
                <Plus className="size-4" />
                {tr("home.create-project")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <Plus className="size-4" />
                <div className="flex flex-col">
                  <span>{tr("home.create-project")}</span>
                  {maxProjects && (
                    <span className="text-muted-foreground text-xs">
                      {tr("home.create-project.max", {
                        args: [String(maxProjects)],
                      })}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

export default ProjectSwitcher;
