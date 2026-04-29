import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import { useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter, useRouterState } from "alepha/react/router";
import { Columns3, Plus, Square, SquareCheck, Table } from "lucide-react";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { kanbanProjectAtom } from "../../../atoms/kanbanProjectAtom.ts";
import { userProjectsAtom } from "../../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export type HeaderProjectProps = {};

const HeaderProject = (_props: HeaderProjectProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [kanban] = useStore(kanbanProjectAtom);
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const { params } = routerState;
  const [projects = []] = useStore(userProjectsAtom);
  const auth = useAuth();

  const activeProject = project ?? kanban?.project;
  if (!activeProject) {
    return null;
  }

  const isKanban = routerState.name === "kanban";
  const projectId = activeProject.id;

  const handleToggle = (value: string) => {
    if (!value) return;
    setTimeout(() => {
      if (value === "kanban") {
        router.push("kanban", { params: { projectId: String(projectId) } });
      } else {
        router.push("project", { params: { projectId: String(projectId) } });
      }
    });
  };

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="capitalize">
            {activeProject.title}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() =>
                router.push("project", { params: { projectId: String(p.id) } })
              }
            >
              {params.projectId === String(p.id) ? (
                <SquareCheck className="size-4" />
              ) : (
                <Square className="size-4" />
              )}
              {p.title}
            </DropdownMenuItem>
          ))}
          {!!projects.length && <DropdownMenuSeparator />}
          <DropdownMenuItem asChild>
            <Link href={router.path("projectCreate")}>
              <Plus className="size-4" />
              {tr("home.create-campaign")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {auth.user && projects.some((p) => p.id === projectId) && (
        <ToggleGroup
          type="single"
          size="sm"
          value={isKanban ? "kanban" : "roadmap"}
          onValueChange={handleToggle}
        >
          <ToggleGroupItem value="roadmap" aria-label="Board">
            <Table className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="kanban" aria-label="Kanban">
            <Columns3 className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      )}
    </div>
  );
};

export default HeaderProject;
