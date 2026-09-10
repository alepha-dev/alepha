import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { Project } from "../../api/schemas/projectSchema.ts";
import type { ProjectState } from "../../api/schemas/projectStateSchema.ts";
import { AddProjectDialog } from "./AddProjectDialog.tsx";
import { ProjectItem } from "./ProjectItem.tsx";
import { SideBarAction } from "./SideBarAction.tsx";
import { SideBarSection } from "./SideBarSection.tsx";
import { WorktreeItem } from "./WorktreeItem.tsx";

export interface SideBarProps {
  projects: Project[];
  project?: Project;
  state?: ProjectState;
  loading: boolean;
  /**
   * The active editor tab, so the worktree it shows is highlighted.
   */
  active: string;
  onOpen: (path: string) => void;
  onRefresh: () => void;
}

/**
 * The side bar: the project list, then the selected project's worktrees as
 * the second section, titled with the project's name the way VS Code titles
 * a folder.
 */
export const SideBar = (props: SideBarProps) => {
  const [adding, setAdding] = useState(false);

  return (
    <aside className="bg-sidebar text-sidebar-foreground flex h-full min-w-0 flex-col">
      <div className="text-muted-foreground flex h-[35px] shrink-0 items-center px-5 text-[11px] tracking-[0.08em] uppercase">
        Worktrees
      </div>

      <SideBarSection
        title="Projects"
        actions={
          <SideBarAction
            label="Add project"
            icon={Plus}
            onClick={() => setAdding(true)}
          />
        }
      >
        <div className="pb-1">
          {props.projects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              selected={project.id === props.project?.id}
            />
          ))}
          {props.projects.length === 0 && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-muted-foreground hover:text-foreground px-5 py-1 text-left"
            >
              Add a repository to start.
            </button>
          )}
        </div>
      </SideBarSection>

      {props.project && (
        <SideBarSection
          title={props.project.name}
          grow
          actions={
            <SideBarAction
              label="Refresh"
              icon={RefreshCw}
              spinning={props.loading}
              onClick={props.onRefresh}
            />
          }
        >
          {!props.state && (
            <p className="text-muted-foreground px-5 py-1">
              Reading worktrees…
            </p>
          )}
          {props.state?.worktrees.map((worktree) => (
            <WorktreeItem
              key={worktree.path}
              worktree={worktree}
              selected={props.active === worktree.path}
              onOpen={() => props.onOpen(worktree.path)}
            />
          ))}
        </SideBarSection>
      )}

      <AddProjectDialog open={adding} onOpenChange={setAdding} />
    </aside>
  );
};
