import { useStore } from "alepha/react";
import { NestedView } from "alepha/react/router";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import QuestLog from "./QuestLog.tsx";

const ProjectBoard = () => {
  const [project] = useStore(currentProjectAtom);

  if (!project) return null;

  return (
    <div className="flex flex-1 gap-2 overflow-auto p-2">
      <div
        className="hidden shrink-0 lg:flex"
        style={{ width: "25%", minWidth: 240, maxWidth: 420 }}
      >
        <QuestLog />
      </div>
      <div className="flex flex-1 flex-col overflow-auto">
        <NestedView />
      </div>
    </div>
  );
};

export default ProjectBoard;
