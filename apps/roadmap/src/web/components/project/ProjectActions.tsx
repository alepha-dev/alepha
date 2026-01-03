import { useClient, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { useRouter, useRouterState } from "@alepha/react/router";
import {
  Card,
  Center,
  Drawer,
  Flex,
  Group,
  SegmentedControl,
  Transition,
} from "@mantine/core";
import {
  IconBrush,
  IconChartLine,
  IconPlus,
  IconSettings,
  IconTable,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import type { TaskController } from "../../../api/controllers/TaskController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../ui/Action.jsx";
import TaskCreate from "./task/TaskCreate.jsx";

type TabValue =
  | "projectBoard"
  | "projectPlayers"
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
          <span>{tr("project.menu.board")}</span>
        </Center>
      ),
    },
    {
      value: "projectWhiteboards",
      label: (
        <Center style={{ gap: 6 }}>
          <IconBrush size={theme.icon.size.sm} />
          <span>{tr("project.menu.whiteboards")}</span>
        </Center>
      ),
    },
    {
      value: "projectPlayers",
      label: (
        <Center style={{ gap: 6 }}>
          <IconUsers size={theme.icon.size.sm} />
          <span>{tr("project.menu.players")}</span>
        </Center>
      ),
    },
    {
      value: "projectAnalytics",
      label: (
        <Center style={{ gap: 6 }}>
          <IconChartLine size={theme.icon.size.sm} />
          <span>{tr("project.menu.analytics")}</span>
        </Center>
      ),
    },
    {
      value: "projectSettings",
      label: (
        <Center style={{ gap: 6 }}>
          <IconSettings size={theme.icon.size.sm} />
          <span>{tr("project.menu.settings")}</span>
        </Center>
      ),
    },
  ];

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
          <Group flex={1}>
            <SegmentedControl
              size={"md"}
              value={routerState.name}
              onChange={(value) => router.go(value as TabValue, opts)}
              data={tabs}
            />
            <Flex flex={1} />
            <CreateTaskButton />
          </Group>
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
    <Flex>
      <Action
        textVisibleFrom={"sm"}
        variant={"filled"}
        color={"green"}
        disabled={!client.createTask.can()}
        leftSection={<IconPlus />}
        onClick={() => setShowDialog(true)}
      >
        {tr("project.menu.create-task")}
      </Action>
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
