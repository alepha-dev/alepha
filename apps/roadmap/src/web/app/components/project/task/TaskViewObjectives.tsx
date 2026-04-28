import { Flex, Text } from "@alepha/mantine";
import { Checkbox } from "@mantine/core";
import { IconListCheck } from "@tabler/icons-react";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { currentAssignedTasksAtom } from "@/web/app/atoms/currentAssignedTasksAtom.ts";
import { theme } from "@/web/app/constants/theme.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

interface TaskViewObjectivesProps {
  task: TaskResource;
  onTaskUpdate?: (updatedTask: TaskResource) => void;
}

const TaskViewObjectives = ({
  task,
  onTaskUpdate,
}: TaskViewObjectivesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const taskApi = useClient<TaskController>();
  const [assignedTasks, setCurrentAssignedTasks] = useStore(
    currentAssignedTasksAtom,
  );

  const handleObjectiveToggle = async (index: number) => {
    try {
      const updatedTask = await taskApi.completeObjective({
        params: { id: task.id },
        body: { index },
      });
      onTaskUpdate?.(updatedTask);
      setCurrentAssignedTasks(
        (assignedTasks ?? []).map((t) =>
          t.id === updatedTask.id ? updatedTask : t,
        ),
      );
    } catch (error) {
      console.error("Failed to update objective:", error);
    }
  };

  if (task.objectives.length === 0) {
    return null;
  }

  return (
    <>
      <Flex gap={"xs"} align="center" justify="center">
        <IconListCheck size={theme.icon.size.lg} />
        <Text size="lg" fw={"bold"}>
          {tr("task.view.objectives")}
        </Text>
        <Flex
          w={"100%"}
          style={{
            opacity: 0.1,
            height: 1,
            backgroundColor: "var(--alepha-text)",
          }}
        />
      </Flex>

      {task.objectives.length > 0 ? (
        <Flex direction="column" py={"xs"} px={"sm"}>
          {task.objectives.map((objective, index) => (
            <Checkbox
              style={{
                cursor: "pointer",
              }}
              key={index}
              checked={objective.completed}
              onChange={() => handleObjectiveToggle(index)}
              disabled={!!task.completedAt || !task.acceptedAt}
              label={
                <Text
                  size={"sm"}
                  style={{
                    textDecoration: objective.completed
                      ? "line-through"
                      : "none",
                    color: objective.completed
                      ? "var(--color-green)"
                      : "var(--alepha-text)",
                  }}
                >
                  {objective.title}
                </Text>
              }
            />
          ))}
        </Flex>
      ) : (
        <Text size={"sm"}>{tr("task.view.noObjectives")}</Text>
      )}
    </>
  );
};

export default TaskViewObjectives;
