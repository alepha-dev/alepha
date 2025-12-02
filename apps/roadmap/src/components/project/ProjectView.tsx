import { NestedView } from "@alepha/react";
import { Card, Container, Flex, Stack } from "@mantine/core";
import { theme } from "../../constants/theme.ts";
import ExperienceBar from "../misc/ExperienceBar.jsx";
import ProjectActions from "./ProjectActions.jsx";
import ProjectBanner from "./ProjectBanner.jsx";
import QuestLog from "./QuestLog.jsx";
import TaskHistory from "./task/TaskHistory.jsx";

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
        p={"xs"}
        flex={1}
        radius={0}
        bg={theme.colors.panel}
        withBorder
        style={{
          borderLeft: 0,
          borderRight: 0,
        }}
      >
        <Flex flex={1} className={"overflow-auto"}>
          <Flex flex={1} visibleFrom={"md"}>
            <QuestLog />
          </Flex>

          <Container
            fluid
            className={"overflow-auto"}
            h={"100%"}
            w={theme.container}
            mx={0}
            px={{
              base: 0,
              md: "xs",
            }}
          >
            <Stack w={"100%"} gap={"xs"} h={"100%"} className={"overflow-auto"}>
              <Flex hiddenFrom={"lg"} w={"100%"}>
                <ProjectActions />
              </Flex>
              <Flex visibleFrom={"xs"}>
                <ProjectBanner />
              </Flex>
              <NestedView />
            </Stack>
          </Container>

          <Flex
            flex={1}
            visibleFrom={"lg"}
            style={{
              height: "100%",
            }}
          >
            <TaskHistory />
          </Flex>
        </Flex>
      </Card>
      <ExperienceBar />
    </Flex>
  );
};

export default ProjectView;
