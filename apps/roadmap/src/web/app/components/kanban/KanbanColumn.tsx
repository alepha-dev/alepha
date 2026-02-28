import { Flex, Text } from "@alepha/ui";
import { useDroppable } from "@dnd-kit/core";
import { ScrollArea } from "@mantine/core";
import { useI18n } from "alepha/react/i18n";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import type { I18n } from "../../services/I18n.ts";
import KanbanCard from "./KanbanCard.tsx";

type ColumnStatus = "new" | "accepted" | "completed";

export interface KanbanColumnProps {
  status: ColumnStatus;
  tasks: TaskResource[];
  readOnly: boolean;
  last?: boolean;
  onSelect: (task: TaskResource) => void;
}

const columnKeys = {
  new: "kanban.column.new",
  accepted: "kanban.column.accepted",
  completed: "kanban.column.completed",
} as const;

const columnColors: Record<ColumnStatus, string> = {
  new: "var(--mantine-color-blue-5)",
  accepted: "var(--mantine-color-orange-5)",
  completed: "var(--mantine-color-green-5)",
};

const KanbanColumn = (props: KanbanColumnProps) => {
  const { status, tasks, readOnly, last, onSelect } = props;
  const { tr } = useI18n<I18n, "en">();
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { type: "column", status },
  });

  return (
    <Flex
      direction="column"
      flex={1}
      miw={280}
      style={{
        borderRight: last
          ? undefined
          : "1px solid var(--mantine-color-default-border)",
        overflow: "hidden",
      }}
    >
      {/* Column header */}
      <Flex
        align="center"
        gap="xs"
        px="sm"
        py="xs"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Flex
          w={8}
          h={8}
          style={{
            borderRadius: "50%",
            backgroundColor: columnColors[status],
            flexShrink: 0,
          }}
        />
        <Text fw={600} size="sm">
          {tr(columnKeys[status])}
        </Text>
        <Text size="xs" c="dimmed">
          {tasks.length}
        </Text>
      </Flex>

      {/* Column body — scrollable */}
      <ScrollArea
        flex={1}
        type="auto"
        ref={setNodeRef}
        scrollbarSize={6}
        style={{
          backgroundColor: isOver ? "rgba(64, 192, 87, 0.08)" : undefined,
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
                {tr("kanban.empty")}
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
