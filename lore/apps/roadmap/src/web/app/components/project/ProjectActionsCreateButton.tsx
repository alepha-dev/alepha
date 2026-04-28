import { ActionButton, Flex } from "@alepha/mantine";
import { Card, Drawer } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { theme } from "../../constants/theme.ts";
import type { I18n } from "../../services/I18n.ts";
import TaskCreate from "./task/TaskCreate.tsx";

export type ProjectActionsCreateButtonProps = {};

const ProjectActionsCreateButton = (props: ProjectActionsCreateButtonProps) => {
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

export default ProjectActionsCreateButton;
