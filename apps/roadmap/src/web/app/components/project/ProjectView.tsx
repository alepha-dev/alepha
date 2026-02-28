import { Flex } from "@alepha/ui";
import { Card } from "@mantine/core";
import { NestedView } from "alepha/react/router";
import { theme } from "../../constants/theme.ts";
import ExperienceBar from "../misc/ExperienceBar.tsx";
import ProjectActions from "./ProjectActions.tsx";

const ProjectView = () => {
  return (
    <Flex
      direction={"column"}
      p={0}
      gap={0}
      flex={1}
      className={"overflow-auto"}
    >
      <Card
        p={0}
        flex={1}
        radius={0}
        bg={theme.colors.panel}
        withBorder
        style={{
          borderLeft: 0,
          borderRight: 0,
        }}
      >
        <Flex
          w={"100%"}
          gap={"xs"}
          flex={1}
          className={"overflow-auto"}
          direction="column"
        >
          <Flex hiddenFrom={"lg"} w={"100%"}>
            <ProjectActions />
          </Flex>
          <Flex
            direction="column"
            flex={1}
            gap={"xs"}
            h={"100%"}
            w={"100%"}
            className={"overflow-auto"}
          >
            <NestedView />
          </Flex>
        </Flex>
      </Card>
      <ExperienceBar />
    </Flex>
  );
};

export default ProjectView;
