import { NestedView } from "alepha/react/router";
import ExperienceBar from "../misc/ExperienceBar.tsx";
import ProjectActions from "./ProjectActions.tsx";

const ProjectView = () => {
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="bg-card border-border flex flex-1 flex-col overflow-auto border-y">
        <div className="flex w-full flex-1 flex-col gap-2 overflow-auto">
          <div className="flex w-full lg:hidden">
            <ProjectActions />
          </div>
          <div className="flex h-full w-full flex-1 flex-col gap-2 overflow-auto">
            <NestedView />
          </div>
        </div>
      </div>
      <ExperienceBar />
    </div>
  );
};

export default ProjectView;
