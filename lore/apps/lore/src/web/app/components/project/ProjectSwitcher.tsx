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
import { Check, ChevronsUpDown, Home, Plus } from "lucide-react";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";

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
  const sorted = [...projects].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
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
            {sorted.map((c) => {
              const isActive = c.id === project.id;
              return (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => {
                    if (!isActive) {
                      router.push("project", {
                        params: { projectSlug: c.slug },
                      });
                    }
                  }}
                >
                  <ProjectIcon fileId={c.icon} className="size-6" />
                  <span className="flex-1 truncate">{c.title}</span>
                  {isActive && <Check className="size-4" />}
                </DropdownMenuItem>
              );
            })}
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
