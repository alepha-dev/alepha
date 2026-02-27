import { useDroppable } from "@dnd-kit/core";
import { Flex, ScrollArea, Text } from "@mantine/core";
import type { Task } from "../../../../api/entities/tasks.ts";
import KanbanCard from "./KanbanCard.tsx";

type ColumnStatus = "new" | "accepted" | "completed";

const columnLabels: Record<ColumnStatus, string> = {
  new: "New",
  accepted: "In Progress",
  completed: "Completed",
};

const columnColors: Record<ColumnStatus, string> = {
  new: "var(--mantine-color-blue-5)",
  accepted: "var(--mantine-color-orange-5)",
  completed: "var(--mantine-color-green-5)",
};

const KanbanColumn = ({
  status,
  tasks,
  readOnly,
  last,
  onSelect,
}: {
  status: ColumnStatus;
  tasks: Task[];
  readOnly: boolean;
  last?: boolean;
  onSelect: (task: Task) => void;
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: "column", status },
  });

  return (
    <Flex
      direction="column"
      flex={1}
      gap={0}
      miw={280}
      style={{
        borderRight: last
          ? undefined
          : "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Flex align="center" gap="xs" px="sm" py="xs">
        <Flex
          w={8}
          h={8}
          style={{
            borderRadius: "50%",
            backgroundColor: columnColors[status],
          }}
        />
        <Text fw={600} size="sm">
          {columnLabels[status]}
        </Text>
        <Text size="xs" c="dimmed">
          {tasks.length}
        </Text>
      </Flex>

      <ScrollArea
        flex={1}
        type="auto"
        ref={setNodeRef}
        style={{
          backgroundColor: isOver ? "rgba(64, 192, 87, 0.08)" : undefined,
          borderRadius: 8,
          transition: "background-color 0.2s ease",
        }}
      >
        <Flex direction="column" gap={2} p={4} mih={100}>
          {tasks.length === 0 && (
            <Flex
              align="center"
              justify="center"
              py="xl"
              style={{ opacity: 0.4 }}
            >
              <Text size="sm" c="dimmed">
                No tasks
              </Text>
            </Flex>
          )}
          {tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              readOnly={readOnly}
              onSelect={onSelect}
            />
          ))}
        </Flex>
      </ScrollArea>
    </Flex>
  );
};

export default KanbanColumn;
