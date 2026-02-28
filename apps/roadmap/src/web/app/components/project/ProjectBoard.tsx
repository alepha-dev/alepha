import { Flex } from "@alepha/ui";
import { useStore } from "alepha/react";
import { NestedView } from "alepha/react/router";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import QuestLog from "./QuestLog.tsx";

const ProjectBoard = () => {
  const [project] = useStore(currentProjectAtom);

  if (!project) return null;

  return (
    <Flex p={"xs"} flex={1} gap="xs" className="overflow-auto">
      <Flex
        visibleFrom="lg"
        style={{
          width: "25%",
          minWidth: 240,
          maxWidth: 420,
          flexShrink: 0,
        }}
      >
        <QuestLog />
      </Flex>
      <Flex flex={1} className="overflow-auto">
        <NestedView />
      </Flex>
    </Flex>
  );
};

export default ProjectBoard;
