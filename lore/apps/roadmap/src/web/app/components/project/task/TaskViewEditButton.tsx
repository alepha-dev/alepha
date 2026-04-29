import { ActionButton, Flex } from "@alepha/mantine";
import { Card, Drawer } from "@mantine/core";
import { IconEdit } from "@tabler/icons-react";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TaskCreate from "./TaskCreate.tsx";

export interface TaskViewEditButtonProps {
  task: TaskResource;
  onUpdate: (task: TaskResource) => void;
  showDialog?: boolean;
  setShowDialog?: (show: boolean) => void;
}

const TaskViewEditButton = (props: TaskViewEditButtonProps) => {
  const { showDialog = false, setShowDialog = () => {} } = props;

  const client = useClient<TaskController>();
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  if (!client.updateTaskById.can()) {
    return null;
  }

  return (
    <Flex>
      <ActionButton
        px={"xs"}
        variant={"minimal"}
        tooltip={tr("task.view.edit")}
        onClick={() => {
          setShowDialog(true);
        }}
      >
        <IconEdit size={theme.icon.size.md} />
      </ActionButton>
      <Drawer
        title={tr("task.create.update")}
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
          <TaskCreate
            project={project}
            task={props.task}
            onSubmit={(task) => {
              setShowDialog(false);
              props.onUpdate(task);
            }}
          />
        </Card>
      </Drawer>
    </Flex>
  );
};

export default TaskViewEditButton;
