import { ActionButton, Flex, Text } from "@alepha/ui";
import { useDroppable } from "@dnd-kit/core";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";
import type { Task } from "../../../../../api/entities/tasks.ts";
import type { I18n } from "../../../services/I18n.ts";
import { openRenameZoneModal } from "./RenameZoneModal.tsx";
import TaskItem from "./TaskItem.tsx";

interface TaskGroupProps {
  name: string;
  tasks: Task[];
}

const TaskGroup = (props: TaskGroupProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [isCollapsed, setIsCollapsed] = useState(true);

  const { setNodeRef, isOver } = useDroppable({
    id: `zone-${props.name}`,
    data: {
      type: "zone",
      zoneName: props.name,
    },
  });

  // sort by complexity
  const tasks = [...props.tasks].sort((a, b) =>
    a.complexity - b.complexity > 0 ? -1 : 1,
  );

  const handleRenameZone = (e: React.MouseEvent) => {
    e.stopPropagation();
    openRenameZoneModal(props.name);
  };

  return (
    <Flex
      direction="column"
      gap={0}
      ref={setNodeRef}
      style={{
        backgroundColor: isOver ? "rgba(64, 192, 87, 0.1)" : undefined,
        borderRadius: isOver ? "4px" : undefined,
        transition: "background-color 0.2s ease",
      }}
    >
      <Flex p={0} align="center" justify="center" gap={"xs"}>
        <Flex align="center" justify="center">
          <ActionButton
            size={"xs"}
            variant={"minimal"}
            onClick={() => setIsCollapsed(!isCollapsed)}
            px="xs"
          >
            {isCollapsed ? <IconMinus size={10} /> : <IconPlus size={10} />}
          </ActionButton>
          <ActionButton
            px={"xs"}
            size={"xs"}
            variant={"minimal"}
            onClick={handleRenameZone}
          >
            <Text fw={"bold"}>{props.name}</Text>
          </ActionButton>
        </Flex>
        <Flex flex={1} align="center" justify="center" px={2}>
          <Flex
            style={{
              height: 1,
              opacity: 0.2,
              width: "100%",
              backgroundColor: "var(--alepha-text-muted)",
            }}
          />
        </Flex>
        <Flex>
          <Text c={"dimmed"} size="sm">
            {tr("task.group.quests", { args: [String(props.tasks.length)] })}
          </Text>
        </Flex>
      </Flex>
      {isCollapsed && (
        <Flex direction="column" gap={0}>
          {tasks.map((item, index) => (
            <TaskItem key={item.id} task={item} index={index} />
          ))}
        </Flex>
      )}
    </Flex>
  );
};

export default TaskGroup;
