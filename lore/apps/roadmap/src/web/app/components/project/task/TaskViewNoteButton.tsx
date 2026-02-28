import { ActionButton, Flex } from "@alepha/ui";
import { Card, Drawer, Textarea } from "@mantine/core";
import { IconNotes } from "@tabler/icons-react";
import { useAlepha, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { currentAssignedTasksAtom } from "@/web/app/atoms/currentAssignedTasksAtom.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface TaskViewNoteButtonProps {
  task: TaskResource;
  onUpdate: (task: TaskResource) => void;
}

const TaskViewNoteButton = (props: TaskViewNoteButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [noteText, setNoteText] = useState(props.task.note || "");
  const client = useClient<TaskController>();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();

  if (!client.updateTaskNote.can()) {
    return null;
  }

  const handleSave = async () => {
    const updatedTask = await client.updateTaskNote({
      params: { id: props.task.id },
      body: { note: noteText },
    });
    props.onUpdate(updatedTask);
    // Update local state
    const currentTasks = alepha.store.get(currentAssignedTasksAtom) || [];
    const updatedTasks = currentTasks.map((t) =>
      t.id === updatedTask.id ? updatedTask : t,
    );
    alepha.store.set(currentAssignedTasksAtom, updatedTasks);
    setShowDialog(false);
  };

  return (
    <Flex>
      <ActionButton
        px={"xs"}
        variant={"minimal"}
        tooltip={tr("task.view.notes")}
        onClick={() => {
          setNoteText(props.task.note || "");
          setShowDialog(true);
        }}
      >
        <IconNotes size={theme.icon.size.md} />
      </ActionButton>
      <Drawer
        title={tr("task.view.notes.title")}
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
          p={"md"}
        >
          <Flex direction="column" gap={"md"}>
            <Textarea
              placeholder={tr("task.view.notes.placeholder")}
              value={noteText}
              onChange={(e) => setNoteText(e.currentTarget.value)}
              minRows={10}
              autosize
            />
            <Flex justify={"flex-end"} gap={"sm"}>
              <ActionButton
                variant={"minimal"}
                onClick={() => setShowDialog(false)}
              >
                {tr("common.cancel")}
              </ActionButton>
              <ActionButton variant={"filled"} onClick={handleSave}>
                {tr("task.view.notes.save")}
              </ActionButton>
            </Flex>
          </Flex>
        </Card>
      </Drawer>
    </Flex>
  );
};

export default TaskViewNoteButton;
