import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Card,
  Center,
  Drawer,
  SegmentedControl,
  Transition,
} from "@mantine/core";
import {
  IconBook2,
  IconBrush,
  IconChartLine,
  IconPlus,
  IconSettings,
  IconTable,
} from "@tabler/icons-react";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter, useRouterState } from "alepha/react/router";
import { useState } from "react";
import type { TaskController } from "../../../../api/controllers/TaskController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import TaskCreate from "./task/TaskCreate.tsx";

type TabValue =
  | "projectBoard"
  | "projectChapters"
  | "projectAnalytics"
  | "projectWhiteboards"
  | "projectSettings";

const ProjectActions = () => {
  const [project] = useStore(currentProjectAtom);
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const routerState = useRouterState();

  const opts = {
    params: { projectId: String(project?.id) },
  };

  const tabs: Array<{ value: TabValue; label: React.ReactNode }> = [
    {
      value: "projectBoard",
      label: (
        <Center style={{ gap: 6 }}>
          <IconTable size={theme.icon.size.sm} />
          <Flex visibleFrom={"sm"}>
            <Text size={"sm"}>{tr("project.menu.board")}</Text>
          </Flex>
        </Center>
      ),
    },
    {
      value: "projectChapters",
      label: (
        <Center style={{ gap: 6 }}>
          <IconBook2 size={theme.icon.size.sm} />
          <Flex visibleFrom={"sm"}>
            <Text size={"sm"}>{tr("project.menu.chapters")}</Text>
          </Flex>
        </Center>
      ),
    },
    {
      value: "projectWhiteboards",
      label: (
        <Center style={{ gap: 6 }}>
          <IconBrush size={theme.icon.size.sm} />
          <Flex visibleFrom={"sm"}>
            <Text size={"sm"}>{tr("project.menu.whiteboards")}</Text>
          </Flex>
        </Center>
      ),
    },
    {
      value: "projectAnalytics",
      label: (
        <Center style={{ gap: 6 }}>
          <IconChartLine size={theme.icon.size.sm} />
          <Flex visibleFrom={"sm"}>
            <Text size={"sm"}>{tr("project.menu.analytics")}</Text>
          </Flex>
        </Center>
      ),
    },
    {
      value: "projectSettings",
      label: (
        <Center style={{ gap: 6 }}>
          <IconSettings size={theme.icon.size.sm} />
          <Flex visibleFrom={"sm"}>
            <Text size={"sm"}>{tr("project.menu.settings")}</Text>
          </Flex>
        </Center>
      ),
    },
  ];

  let name = routerState.name;
  if (name === "projectBoardTable") {
    name = "projectBoard";
  }

  return (
    <Transition mounted={!!project} transition={"fade-down"}>
      {(styles) => (
        <Card style={styles} flex={1} py={2} px={2} withBorder radius={"md"}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 1,
              opacity: 0.05,
              transform: "rotate(2deg) translateY(-25px)",
              background: "#ffffff",
            }}
          />
          <Flex centerY flex={1}>
            <SegmentedControl
              size={"md"}
              value={name}
              onChange={(value) => router.push(value as TabValue, opts)}
              data={tabs}
            />
            <Flex flex={1} />
            <CreateTaskButton />
          </Flex>
        </Card>
      )}
    </Transition>
  );
};

export default ProjectActions;

const CreateTaskButton = () => {
  const [showDialog, setShowDialog] = useState(false);
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<TaskController>();

  const [project] = useStore(currentProjectAtom);
  if (!project) {
    return null;
  }

  return (
    <Flex px={"xs"}>
      <ActionButton
        size={"xs"}
        textVisibleFrom={"xl"}
        variant={"filled"}
        color={"green"}
        disabled={!client.createTask.can()}
        icon={IconPlus}
        onClick={() => setShowDialog(true)}
      >
        {tr("project.menu.create-task")}
      </ActionButton>
      <Drawer
        title={tr("project.menu.create-task")}
        size={"xl"}
        position={"right"}
        opened={showDialog}
        onClose={() => setShowDialog(false)}
        className={"drawer"}
      >
        <Card
          withBorder
          bg={theme.colors.card}
          radius={"md"}
          className={"shadow"}
        >
          <TaskCreate project={project} onSubmit={() => setShowDialog(false)} />
        </Card>
      </Drawer>
    </Flex>
  );
};
