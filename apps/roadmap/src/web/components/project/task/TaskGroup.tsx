import { useDroppable } from "@dnd-kit/core";
import { ActionIcon, Button, Flex, Stack, Text } from "@mantine/core";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import type { Task } from "../../../../api/entities/tasks.ts";
import { openRenameZoneModal } from "./RenameZoneModal.jsx";
import TaskItem from "./TaskItem.jsx";

interface TaskGroupProps {
  name: string;
  tasks: Task[];
}

const TaskGroup = (props: TaskGroupProps) => {
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
    <Stack
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
          <ActionIcon
            size={"xs"}
            variant={"subtle"}
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <IconMinus size={10} /> : <IconPlus size={10} />}
          </ActionIcon>
          <Button
            px={"xs"}
            size={"xs"}
            variant={"subtle"}
            onClick={handleRenameZone}
          >
            <Text fw={"bold"}>{props.name}</Text>
          </Button>
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
            {props.tasks.length} task{props.tasks.length > 1 ? "s" : ""}
          </Text>
        </Flex>
      </Flex>
      {isCollapsed && (
        <Stack gap={0}>
          {tasks.map((item, index) => (
            <TaskItem key={item.id} task={item} index={index} />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default TaskGroup;
