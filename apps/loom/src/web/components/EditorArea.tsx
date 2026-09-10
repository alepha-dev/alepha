import { GitBranch, House, Info, LayoutList } from "lucide-react";

import type { Project } from "../../api/schemas/projectSchema.ts";
import type { ProjectState } from "../../api/schemas/projectStateSchema.ts";
import { EditorTab } from "./EditorTab.tsx";
import { OverviewView } from "./OverviewView.tsx";
import { WelcomeView } from "./WelcomeView.tsx";
import { WorktreeView } from "./WorktreeView.tsx";

export interface EditorAreaProps {
  projects: Project[];
  project?: Project;
  state?: ProjectState;
  error?: Error;
  /**
   * Worktree paths open as tabs, in the order they were opened.
   */
  tabs: string[];
  /**
   * `"overview"` or one of {@link tabs}.
   */
  active: string;
  onActivate: (tab: string) => void;
  onOpen: (path: string) => void;
  onClose: (path: string) => void;
  onRefresh: () => void;
}

/**
 * The editor: a tab strip over the active view. Overview is always first and
 * never closes; a worktree opens in a tab of its own. Without a project, the
 * one tab is Welcome.
 */
export const EditorArea = (props: EditorAreaProps) => {
  const worktree = props.state?.worktrees.find(
    (it) => it.path === props.active,
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div
        role="tablist"
        aria-label="Editors"
        className="bg-frame border-border flex h-[35px] shrink-0 overflow-x-auto border-b"
      >
        {props.project ? (
          <>
            <EditorTab
              label="Overview"
              icon={LayoutList}
              active={props.active === "overview"}
              onSelect={() => props.onActivate("overview")}
            />
            {props.tabs.map((path) => {
              const tab = props.state?.worktrees.find((it) => it.path === path);
              return (
                <EditorTab
                  key={path}
                  label={tab?.name ?? path.slice(path.lastIndexOf("/") + 1)}
                  icon={tab?.isMain ? House : GitBranch}
                  active={props.active === path}
                  onSelect={() => props.onActivate(path)}
                  onClose={() => props.onClose(path)}
                />
              );
            })}
          </>
        ) : (
          <EditorTab
            label="Welcome"
            icon={Info}
            active
            onSelect={() => undefined}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!props.project ? (
          <WelcomeView projects={props.projects} />
        ) : props.active === "overview" ? (
          <OverviewView
            project={props.project}
            state={props.state}
            error={props.error}
            onOpen={props.onOpen}
            onRefresh={props.onRefresh}
          />
        ) : (
          <WorktreeView
            path={props.active}
            worktree={worktree}
            state={props.state}
          />
        )}
      </div>
    </div>
  );
};
