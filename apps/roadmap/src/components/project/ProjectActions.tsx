import { useClient, useRouter, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { Card, Drawer, Flex, Group, Transition } from "@mantine/core";
import {
  IconChartLine,
  IconPlus,
  IconSettings,
  IconTable,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type { TaskApi } from "../../api/TaskApi.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import Action, { type ActionProps } from "../ui/Action.jsx";
import TaskCreate from "./task/TaskCreate.jsx";

const ProjectActions = () => {
  const [project] = useStore("current_project");
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();

  const opts = {
    params: { projectId: String(project?.id) },
  };

  return (
    <Transition mounted={!!project} transition={"fade-down"}>
      {(styles) => (
        <Card
          style={styles}
          flex={1}
          py={"xs"}
          px={"sm"}
          withBorder
          radius={"md"}
        >
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
            <Flex gap={"xs"}>
              <TabAction
                leftSection={<IconTable size={theme.icon.size.sm} />}
                href={router.path("projectBoard", opts)}
              >
                {tr("project.menu.board")}
              </TabAction>
              <TabAction
                leftSection={<IconUsers size={theme.icon.size.sm} />}
                href={router.path("projectPlayers", opts)}
              >
                {tr("project.menu.players")}
              </TabAction>
              <TabAction
                leftSection={<IconChartLine size={theme.icon.size.sm} />}
                href={router.path("projectAnalytics", opts)}
              >
                {tr("project.menu.analytics")}
              </TabAction>
              <TabAction
                leftSection={<IconSettings size={theme.icon.size.sm} />}
                href={router.path("projectSettings", opts)}
              >
                {tr("project.menu.settings")}
              </TabAction>
            </Flex>
            <Flex flex={1} />
            <CreateTaskButton />
          </Group>
        </Card>
      )}
    </Transition>
  );
};

const TabAction = (props: ActionProps & { href: string }) => {
  return <Action {...props} textVisibleFrom={"md"} variant={"minimal"} />;
};

export default ProjectActions;

const CreateTaskButton = () => {
  const [showDialog, setShowDialog] = useState(false);
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<TaskApi>();

  const [project] = useStore("current_project");
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
