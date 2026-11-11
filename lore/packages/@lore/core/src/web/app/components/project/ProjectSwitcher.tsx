import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useIsMobile,
} from "@alepha/ui";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Check, ChevronsUpDown, Home, LayoutGrid, Plus } from "lucide-react";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userDockAtom } from "../../atoms/userDockAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import { RECENT_PROJECTS_CAP } from "./recentProjectsCap.ts";

/**
 * The top of the project sidebar.
 *
 * On desktop a plain title, the current project's icon and name: switching is
 * the rail's job there (#Q3374), and a second switcher beside it was one too
 * many. At phone width the rail is hidden, so the dropdown below stays the
 * way to change project. `useIsMobile` breaks at 768px, the rail's `md`.
 *
 * ⚠️ One or the other, never both hidden by CSS: two copies of the title
 * would make every `getByText(title)` in the e2e suite ambiguous. The server
 * draws the desktop title; a phone swaps in the dropdown on hydration, while
 * its sidebar is still the closed off-canvas sheet, so nothing flashes.
 */
const ProjectSwitcher = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);
  const [overview] = useStore(userProjectsAtom);
  const [dock] = useStore(userDockAtom);
  const isMobile = useIsMobile();

  if (!project) {
    return null;
  }

  if (!isMobile) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            data-testid="project-title"
            render={<div />}
            className="hover:text-foreground active:text-foreground cursor-default hover:bg-transparent active:bg-transparent"
          >
            <ProjectIcon
              fileId={project.icon}
              title={project.title}
              seed={project.slug}
              className="size-8 rounded-lg"
            />
            <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
              {project.title}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const projects = overview?.projects ?? [];
  const canCreate = overview?.canCreate ?? true;
  const maxProjects = overview?.maxProjects;
  // The rest, most recently updated first — NOT the first ten
  // alphabetically. This list used to be sorted by title, which is right for a
  // complete list (you scan it for a name you know) and wrong for a truncated
  // one: capping an alphabetical sort answers "which ten come first in the
  // alphabet", a question nobody asked, and hides everything from S onwards
  // forever.
  //
  // Archived projects are left out (#Q2601), except the one you are looking
  // at: it still needs its checkmark, and its URL keeps working.
  const byRecency = projects
    .filter((it) => !it.archivedAt || it.id === project.id)
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  // Pinned projects first, in dock order, then the rest by recency (#E139,
  // #Q3441): the phone's switcher is the dock's stand-in, so it agrees with
  // the dock. Every pin is listed, so the cap only trims the rest.
  const byId = new Map(byRecency.map((it) => [it.id, it]));
  const pinned = (dock ?? [])
    .map((id) => byId.get(id))
    .filter((it) => it !== undefined && !it.archivedAt)
    .map((it) => it!);
  const pinnedIds = new Set(pinned.map((it) => it.id));
  const ordered = [
    ...pinned,
    ...byRecency.filter((it) => !pinnedIds.has(it.id)),
  ];
  const cap = Math.max(RECENT_PROJECTS_CAP, pinned.length);
  const recent = ordered.slice(0, cap);
  // The project you are LOOKING AT has to be in the menu, or the switcher
  // shows no checkmark and reads as though you are nowhere. Swap it in for
  // the last of the rest rather than appending, so the cap holds.
  if (!recent.some((it) => it.id === project.id)) {
    const current = byRecency.find((it) => it.id === project.id);
    if (current) recent.splice(cap - 1, 1, current);
  }
  const hasMore = projects.length > recent.length;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="project-switcher"
            render={
              // A Control field's border (feedback #P2179): `--input` at
              // rest, `--border-hover` under the pointer, kept while the menu
              // is open. `border-color` joins the button's own
              // width/height/padding transition rather than replacing it, so
              // the collapse animation is untouched and the border eases on
              // the default curve a field's `transition-colors` uses.
              <SidebarMenuButton
                size="lg"
                className="border-border bg-background text-foreground hover:bg-background hover:text-foreground data-[state=open]:bg-background data-[state=open]:text-foreground hover:border-border-hover border transition-[width,height,padding,border-color]"
              />
            }
          >
            <ProjectIcon
              fileId={project.icon}
              title={project.title}
              seed={project.slug}
              className="size-8 rounded-lg"
            />
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
            // carries `w-(--anchor-width)`, and since `cn()` resolves conflicts
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
                  <ProjectIcon
                    fileId={c.icon}
                    title={c.title}
                    seed={c.slug}
                    className="size-6"
                  />
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
