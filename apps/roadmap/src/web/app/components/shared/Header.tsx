import { ActionButton, Flex } from "@alepha/ui";
import { Burger, Card, Drawer } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useClient, useEvents, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { TaskController } from "../../../../api/controllers/TaskController.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import {
  kanbanProjectAtom,
  kanbanReloadAtom,
} from "../../atoms/kanbanProjectAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import HeaderProjectActions from "../project/ProjectActions.tsx";
import QuestLog from "../project/QuestLog.tsx";
import TaskCreate from "../project/task/TaskCreate.tsx";
import HeaderActions from "./HeaderActions.tsx";
import HeaderProject from "./HeaderProject.tsx";
import RoadmapLogo from "./RoadmapLogo.tsx";

const Header = () => {
  const router = useRouter<AppRouter>();

  return (
    <Flex
      direction={"column"}
      p={"xs"}
      px={"md"}
      gap={"xs"}
      h={64}
      align="center"
      justify="center"
    >
      <Flex w={"100%"} px={2}>
        <Flex gap={"xs"}>
          <Flex align="center" justify="center" gap={"xs"}>
            <MobileQuestLog />
            <Flex>
              <ActionButton
                variant={"minimal"}
                href={router.path("home")}
                active={false}
                leftSection={<RoadmapLogo />}
              />
            </Flex>
            <HeaderProject />
          </Flex>
        </Flex>
        <Flex px={"sm"} flex={1} align="center" justify="center">
          <Flex visibleFrom={"lg"} maw={"900px"}>
            <HeaderProjectActions />
          </Flex>
        </Flex>
        <Flex align="center" justify="end" gap="xs">
          <KanbanCreateButton />
          <HeaderActions />
        </Flex>
      </Flex>
    </Flex>
  );
};

export default Header;

const MobileQuestLog = () => {
  const [show, setShow] = useState(false);
  const [project] = useStore(currentProjectAtom);

  useEvents(
    {
      "react:transition:end": () => setShow(false),
    },
    [],
  );

  if (!project) {
    return null;
  }

  return (
    <Flex hiddenFrom={"md"}>
      <Burger opened={show} onClick={() => setShow(true)} />
      <Drawer
        flex={1}
        bg={theme.colors.panel}
        onClose={() => setShow(false)}
        position={"left"}
        opened={show}
        style={{
          borderRight: "1px solid var(--mantine-color-dark-4)",
        }}
      >
        <QuestLog />
      </Drawer>
    </Flex>
  );
};

const KanbanCreateButton = () => {
  const [showDialog, setShowDialog] = useState(false);
  const { tr } = useI18n<I18n, "en">();
  const client = useClient<TaskController>();
  const [kanban] = useStore(kanbanProjectAtom);
  const [reloadKey, setReloadKey] = useStore(kanbanReloadAtom);

  if (!kanban || kanban.readOnly) {
    return null;
  }

  return (
    <Flex>
      <ActionButton
        textVisibleFrom="sm"
        variant="filled"
        color="green"
        disabled={!client.createTask.can()}
        leftSection={<IconPlus />}
        onClick={() => setShowDialog(true)}
      >
        {tr("project.menu.create-task")}
      </ActionButton>
      <Drawer
        title={tr("project.menu.create-task")}
        size="xl"
        position="right"
        opened={showDialog}
        onClose={() => setShowDialog(false)}
        className="drawer"
      >
        <Card withBorder bg={theme.colors.card} radius="md" className="shadow">
          <TaskCreate
            project={kanban.project}
            onSubmit={() => setShowDialog(false)}
            onCreated={() => {
              setShowDialog(false);
              setReloadKey({ key: (reloadKey?.key ?? 0) + 1 });
            }}
          />
        </Card>
      </Drawer>
    </Flex>
  );
};
