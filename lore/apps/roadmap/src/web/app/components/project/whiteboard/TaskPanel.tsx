import { ActionButton, Flex, Text } from "@alepha/ui";
import { Collapse, Paper, ScrollArea } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronUp,
  IconGripHorizontal,
} from "@tabler/icons-react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useState } from "react";
import type { Task } from "../../../../../api/entities/tasks.ts";
import type { I18n } from "../../../services/I18n.ts";
import TaskComplexity from "../task/TaskComplexity.tsx";
import classes from "./WhiteboardCanvas.module.css";

export interface TaskPanelProps {
  availableTasks: Task[];
  onAddTask: (taskId: number, x?: number, y?: number) => void;
  onDragStart: (e: React.DragEvent, taskId: number) => void;
}

const TaskPanel = ({
  availableTasks,
  onAddTask,
  onDragStart,
}: TaskPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [isOpen, setIsOpen] = useState(true);
  const [panelHeight, setPanelHeight] = useState(300);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startY = e.clientY;
      const startHeight = panelHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = moveEvent.clientY - startY;
        setPanelHeight(Math.max(100, Math.min(500, startHeight + deltaY)));
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [panelHeight],
  );

  return (
    <Paper
      radius="md"
      shadow="md"
      withBorder
      className={classes.taskPanel}
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 10,
        width: 240,
        maxHeight: "calc(100% - 32px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Panel header - always visible */}
      <Flex
        p="xs"
        justify="space-between"
        align="center"
        style={{
          cursor: "pointer",
          borderBottom: isOpen
            ? "1px solid var(--mantine-color-default-border)"
            : "none",
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Text size="sm" fw={500}>
          {tr("whiteboard.quests")} ({availableTasks.length})
        </Text>
        <ActionButton variant="subtle" size="xs">
          {isOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </ActionButton>
      </Flex>

      {/* Collapsible content */}
      <Collapse in={isOpen}>
        <ScrollArea h={panelHeight} p="xs" scrollbarSize={6}>
          <Flex direction="column" gap={4}>
            {availableTasks.length === 0 ? (
              <Text size="xs" c="dimmed" ta="center" py="md">
                {tr("whiteboard.allOnBoard")}
              </Text>
            ) : (
              availableTasks.map((task) => (
                <Flex
                  key={task.id}
                  p={6}
                  gap="sm"
                  align="center"
                  className={classes.taskItem}
                  draggable
                  onDragStart={(e) => onDragStart(e, task.id)}
                  onClick={() => onAddTask(task.id)}
                >
                  <TaskComplexity complexity={task.complexity} />
                  <Text size="sm" lineClamp={1} style={{ flex: 1 }}>
                    {task.title}
                  </Text>
                  {task.priority === "high" && (
                    <Text c="red" fw="bold" size="sm">
                      !
                    </Text>
                  )}
                  {task.priority === "optional" && (
                    <Text c="dimmed" size="sm">
                      ✦
                    </Text>
                  )}
                </Flex>
              ))
            )}
          </Flex>
        </ScrollArea>

        {/* Resize handle */}
        <Flex
          justify="center"
          py={2}
          style={{
            cursor: "ns-resize",
            borderTop: "1px solid var(--mantine-color-default-border)",
          }}
          onMouseDown={handleResizeStart}
        >
          <IconGripHorizontal size={14} opacity={0.5} />
        </Flex>
      </Collapse>
    </Paper>
  );
};

export default TaskPanel;
