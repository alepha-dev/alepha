import { ActionButton, Flex, Text } from "@alepha/ui";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@mantine/core";
import { IconExclamationMark, IconSparkles } from "@tabler/icons-react";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { theme } from "../../constants/theme.ts";
import TaskComplexity from "../project/task/TaskComplexity.tsx";

export interface KanbanCardProps {
  task: TaskResource;
  readOnly: boolean;
  onSelect: (task: TaskResource) => void;
}

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "high":
      return "red";
    case "medium":
      return "orange";
    case "low":
      return "gray";
    default:
      return "dark";
  }
};

const KanbanCard = (props: KanbanCardProps) => {
  const { task, readOnly, onSelect } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `task-${task.id}`,
      data: { type: "task", task },
      disabled: readOnly,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
    padding: 4,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ActionButton
        w="100%"
        h="auto"
        px="xs"
        py={6}
        mb={2}
        justify="start"
        variant="default"
        onClick={() => onSelect(task)}
        {...(readOnly ? {} : { ...attributes, ...listeners })}
        style={{
          cursor: readOnly ? "pointer" : isDragging ? "grabbing" : "grab",
        }}
      >
        <Flex flex={1} align="center" gap="sm" style={{ overflow: "hidden" }}>
          <TaskComplexity complexity={task.complexity} />
          <Flex direction="column" flex={1} style={{ overflow: "hidden" }}>
            <Text
              fw={500}
              size="sm"
              lineClamp={1}
              td={task.completedAt ? "line-through" : undefined}
              c={task.completedAt ? "dimmed" : undefined}
            >
              {task.title}
            </Text>
            <Flex align="center" gap={4}>
              <Text size="xs" c="dimmed">
                {task.package}
              </Text>
              {task.metadata.objectivesProgress.total > 0 && (
                <Text size="10px" c="dimmed">
                  {task.metadata.objectivesProgress.completed}/
                  {task.metadata.objectivesProgress.total}
                </Text>
              )}
            </Flex>
          </Flex>
          <Flex align="center" gap={4}>
            <Badge
              size="xs"
              color={getPriorityColor(task.priority)}
              variant="light"
            >
              {task.priority}
            </Badge>
            {task.priority === "high" && (
              <IconExclamationMark
                size={theme.icon.size.sm}
                color="var(--mantine-color-red-5)"
              />
            )}
            {task.priority === "optional" && (
              <IconSparkles
                size={theme.icon.size.sm}
                color="var(--mantine-color-gray-5)"
              />
            )}
          </Flex>
        </Flex>
      </ActionButton>
    </div>
  );
};

export default KanbanCard;
