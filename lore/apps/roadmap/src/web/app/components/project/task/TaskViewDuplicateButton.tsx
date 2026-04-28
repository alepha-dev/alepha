import { ActionButton, Flex } from "@alepha/mantine";
import { Card, Drawer } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import TaskCreate from "./TaskCreate.tsx";

export interface TaskViewDuplicateButtonProps {
  task: TaskResource;
}

const TaskViewDuplicateButton = (props: TaskViewDuplicateButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const client = useClient<TaskController>();
  const [project] = useStore(currentProjectAtom);
  const { tr } = useI18n<I18n, "en">();

  if (!project) {
    return null;
  }

  if (!client.createTask.can()) {
    return null;
  }

  // Prepare duplicate task data (exclude id and timestamps)
  const duplicateTaskData = {
    title: `${props.task.title} ${tr("task.view.duplicate.suffix")}`,
    description: props.task.description,
    package: props.task.package,
    priority: props.task.priority,
    complexity: props.task.complexity,
    objectives: props.task.objectives.map((obj) => ({
      title: obj.title,
      completed: false, // Reset completion status for duplicate
    })),
  };

  return (
    <Flex>
      <ActionButton
        px={"xs"}
        variant={"minimal"}
        tooltip={tr("task.view.duplicate")}
        onClick={() => {
          setShowDialog(true);
        }}
      >
        <IconCopy size={theme.icon.size.md} />
      </ActionButton>
      <Drawer
        title={tr("task.view.duplicate.title")}
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
            task={duplicateTaskData as TaskResource}
            onSubmit={() => {
              setShowDialog(false);
            }}
          />
        </Card>
      </Drawer>
    </Flex>
  );
};

export default TaskViewDuplicateButton;
