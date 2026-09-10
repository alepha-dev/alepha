import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@alepha/ui/components/ui/resizable";
import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { useState } from "react";

import type { Project } from "../../api/schemas/projectSchema.ts";
import { useProjectState } from "../hooks/useProjectState.ts";
import { ActivityBar } from "./ActivityBar.tsx";
import { EditorArea } from "./EditorArea.tsx";
import { SideBar } from "./SideBar.tsx";
import { StatusBar } from "./StatusBar.tsx";

export interface WorkbenchProps {
  projects: Project[];
  projectId?: string;
}

/**
 * The IDE shell: activity bar, side bar, editor, status bar, where VS Code
 * puts them, so the layout needs no learning.
 *
 * Open tabs are component state, not URL state: they are a working set, and
 * a reload that forgets them loses nothing the side bar does not list again.
 * They belong to one project, so switching projects starts from its
 * overview instead of showing tabs that point into another repository.
 */
export const Workbench = (props: WorkbenchProps) => {
  const project = props.projects.find((it) => it.id === props.projectId);
  const query = useProjectState(project?.id);
  const [session, setSession] = useState<TabSession>({
    paths: [],
    active: "overview",
  });

  const current: TabSession =
    session.projectId === project?.id
      ? session
      : { projectId: project?.id, paths: [], active: "overview" };

  const open = (path: string) => {
    setSession({
      projectId: project?.id,
      paths: current.paths.includes(path)
        ? current.paths
        : [...current.paths, path],
      active: path,
    });
  };

  const close = (path: string) => {
    setSession({
      projectId: project?.id,
      paths: current.paths.filter((it) => it !== path),
      active: current.active === path ? "overview" : current.active,
    });
  };

  const activate = (tab: string) => {
    setSession({ ...current, active: tab });
  };

  return (
    <TooltipProvider delay={300}>
      <DialogProvider>
        <div className="bg-background text-foreground grid h-dvh grid-rows-[minmax(0,1fr)_22px] font-sans text-[13px]">
          <div className="flex min-h-0">
            <ActivityBar />
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel defaultSize={280} minSize={200} maxSize={560}>
                <SideBar
                  projects={props.projects}
                  project={project}
                  state={query.data}
                  loading={query.loading}
                  active={current.active}
                  onOpen={open}
                  onRefresh={() => void query.refetch()}
                />
              </ResizablePanel>
              <ResizableHandle className="bg-sidebar-border" />
              <ResizablePanel>
                <EditorArea
                  projects={props.projects}
                  project={project}
                  state={query.data}
                  error={query.error}
                  tabs={current.paths}
                  active={current.active}
                  onActivate={activate}
                  onOpen={open}
                  onClose={close}
                  onRefresh={() => void query.refetch()}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
          <StatusBar
            project={project}
            state={query.data}
            loading={query.loading}
            error={query.error}
          />
        </div>
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

/**
 * The editor tabs open for one project. `active` is `"overview"` or a
 * worktree path.
 */
interface TabSession {
  projectId?: string;
  paths: string[];
  active: string;
}
