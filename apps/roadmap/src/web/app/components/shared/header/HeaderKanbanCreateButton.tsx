import { ActionButton, Flex } from "@alepha/ui";
import { Card, Drawer } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import {
  kanbanProjectAtom,
  kanbanReloadAtom,
} from "@/web/app/atoms/kanbanProjectAtom.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TaskCreate from "../../project/task/TaskCreate.tsx";

const HeaderKanbanCreateButton = () => {
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

export default HeaderKanbanCreateButton;
