import { useAlepha, useStore } from "@alepha/react";
import { useDialog, useToast } from "@alepha/ui";
import {
  ActionIcon,
  Box,
  Card,
  Collapse,
  Divider,
  Drawer,
  Flex,
  List,
  Modal,
  Paper,
  ScrollArea,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronDown,
  IconChevronUp,
  IconDeviceFloppy,
  IconGripHorizontal,
  IconHelp,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Arrow,
  Circle,
  Text as KonvaText,
  Layer,
  Line,
  Rect,
  Stage,
  Transformer,
} from "react-konva";
import type { Task } from "../../../api/entities/tasks.ts";
import type {
  Whiteboard,
  WhiteboardData,
  WhiteboardElement,
} from "../../../api/entities/whiteboards.ts";
import { currentAssignedTasksAtom } from "../../atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import TaskComplexity from "./task/TaskComplexity.tsx";
import TaskCreate from "./task/TaskCreate.tsx";
import classes from "./WhiteboardCanvas.module.css";
import WhiteboardTaskCard from "./WhiteboardTaskCard.tsx";
import WhiteboardToolbar, { type ToolType } from "./WhiteboardToolbar.tsx";

// Konva types
type KonvaStage = React.ComponentRef<typeof Stage>;
type KonvaTransformer = React.ComponentRef<typeof Transformer>;
interface KonvaEventObject<T> {
  target: {
    getStage: () => unknown;
    x: () => number;
    y: () => number;
    scaleX: () => number;
    scaleY: () => number;
    rotation: () => number;
    width: () => number;
    height: () => number;
  };
  evt: T;
}

export interface WhiteboardControls {
  whiteboards: Whiteboard[];
  currentWhiteboard: Whiteboard | undefined;
  onSelectWhiteboard: (id: string) => void;
  onCreateWhiteboard: () => void;
  onRenameWhiteboard: () => void;
  onDeleteWhiteboard: () => void;
}

export interface WhiteboardCanvasProps {
  whiteboard: Whiteboard;
  onSave: (data: WhiteboardData) => Promise<void>;
  whiteboardControls: WhiteboardControls;
}

const WhiteboardCanvas = ({ whiteboard, onSave }: WhiteboardCanvasProps) => {
  const alepha = useAlepha();
  const toast = useToast();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const [acceptedTasks, setAcceptedTasks] = useStore(currentAssignedTasksAtom);
  const stageRef = useRef<KonvaStage>(null);
  const transformerRef = useRef<KonvaTransformer>(null);
  const [helpOpened, { open: openHelp, close: closeHelp }] =
    useDisclosure(false);

  const [elements, setElements] = useState<WhiteboardElement[]>(
    whiteboard.data.elements,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolType>("select");
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [fillColor, setFillColor] = useState("#ffffff");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState<number[]>([]);
  const [history, setHistory] = useState<WhiteboardElement[][]>([
    whiteboard.data.elements,
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(true);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState("");
  const [editingTextPos, setEditingTextPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [taskPanelHeight, setTaskPanelHeight] = useState(300);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Update elements when whiteboard changes
  useEffect(() => {
    setElements(whiteboard.data.elements);
    setHistory([whiteboard.data.elements]);
    setHistoryIndex(0);
    setIsDirty(false);
  }, [whiteboard.id]);

  // Resize stage to fit container
  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const updateSize = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setStageSize({
          width: rect.width,
          height: rect.height,
        });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const pushHistory = useCallback(
    (newElements: WhiteboardElement[]) => {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newElements);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setIsDirty(true);
    },
    [history, historyIndex],
  );

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setElements(history[newIndex]);
      setIsDirty(true);
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setElements(history[newIndex]);
      setIsDirty(true);
    }
  }, [history, historyIndex]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave({ elements });
      setIsDirty(false);
      toast.success({ message: "Drawing saved" });
    } finally {
      setIsSaving(false);
    }
  }, [elements, onSave, toast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          const newElements = elements.filter((el) => el.id !== selectedId);
          setElements(newElements);
          pushHistory(newElements);
          setSelectedId(null);
        }
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setTool("select");
      } else if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, elements, pushHistory, handleUndo, handleRedo, handleSave]);

  // Update transformer on selection change
  useEffect(() => {
    if (transformerRef.current && stageRef.current) {
      if (selectedId) {
        const node = stageRef.current.findOne(`#${selectedId}`);
        if (node) {
          transformerRef.current.nodes([node]);
          transformerRef.current.getLayer()?.batchDraw();
        }
      } else {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    }
  }, [selectedId]);

  const generateId = () => crypto.randomUUID();

  const getPointerPosition = () => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pos = stage.getPointerPosition();
    return pos ?? { x: 0, y: 0 };
  };

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage();

    if (tool === "select") {
      if (clickedOnEmpty) {
        setSelectedId(null);
      }
      return;
    }

    if (tool === "eraser") {
      return;
    }

    const pos = getPointerPosition();

    if (tool === "line") {
      setIsDrawing(true);
      setCurrentLine([pos.x, pos.y]);
      return;
    }

    // Create new shape
    const newElement: WhiteboardElement = {
      id: generateId(),
      type: tool as WhiteboardElement["type"],
      x: pos.x,
      y: pos.y,
      stroke: strokeColor,
      fill: fillColor,
    };

    if (tool === "rect") {
      newElement.width = 100;
      newElement.height = 60;
    } else if (tool === "circle") {
      newElement.width = 50;
      newElement.height = 50;
    } else if (tool === "arrow") {
      newElement.points = [0, 0, 100, 0];
    } else if (tool === "text") {
      newElement.text = "Text";
      newElement.fontSize = 16;
    }

    const newElements = [...elements, newElement];
    setElements(newElements);
    pushHistory(newElements);
    setSelectedId(newElement.id);
    setTool("select");
  };

  const handleMouseMove = () => {
    if (!isDrawing || tool !== "line") return;

    const pos = getPointerPosition();
    setCurrentLine([...currentLine, pos.x, pos.y]);
  };

  const handleMouseUp = () => {
    if (!isDrawing || tool !== "line") return;

    setIsDrawing(false);

    if (currentLine.length > 2) {
      const newElement: WhiteboardElement = {
        id: generateId(),
        type: "line",
        x: 0,
        y: 0,
        points: currentLine,
        stroke: strokeColor,
        strokeWidth: 2,
      };

      const newElements = [...elements, newElement];
      setElements(newElements);
      pushHistory(newElements);
    }

    setCurrentLine([]);
  };

  const handleDragEnd = (id: string, e: KonvaEventObject<DragEvent>) => {
    const newElements = elements.map((el) =>
      el.id === id ? { ...el, x: e.target.x(), y: e.target.y() } : el,
    );
    setElements(newElements);
    pushHistory(newElements);
  };

  const handleTransformEnd = (id: string, e: KonvaEventObject<unknown>) => {
    const target = e.target as typeof e.target & {
      scaleX: {
        (): number;
        (v: number): void;
      };
      scaleY: {
        (): number;
        (v: number): void;
      };
    };
    const element = elements.find((el) => el.id === id);
    if (!element) return;

    const scaleX = target.scaleX();
    const scaleY = target.scaleY();

    // Reset scale on the node
    target.scaleX(1);
    target.scaleY(1);

    const newElements = elements.map((el) => {
      if (el.id !== id) return el;

      const baseUpdate = {
        ...el,
        x: target.x(),
        y: target.y(),
        rotation: target.rotation(),
      };

      // Handle different element types
      if (el.type === "arrow" && el.points) {
        // Scale arrow points
        const scaledPoints = el.points.map((p, i) =>
          i % 2 === 0 ? p * scaleX : p * scaleY,
        );
        return { ...baseUpdate, points: scaledPoints };
      } else if (el.type === "text") {
        // Scale font size for text
        const newFontSize = Math.max(
          8,
          (el.fontSize ?? 16) * Math.max(scaleX, scaleY),
        );
        return { ...baseUpdate, fontSize: newFontSize };
      } else if (el.type === "line" && el.points) {
        // Scale line points
        const scaledPoints = el.points.map((p, i) =>
          i % 2 === 0 ? p * scaleX : p * scaleY,
        );
        return { ...baseUpdate, points: scaledPoints };
      } else {
        // Default: scale width/height for rect, circle
        return {
          ...baseUpdate,
          width: Math.max(5, (el.width ?? 100) * scaleX),
          height: Math.max(5, (el.height ?? 60) * scaleY),
        };
      }
    });

    setElements(newElements);
    pushHistory(newElements);
  };

  const handleErase = (id: string) => {
    if (tool !== "eraser") return;
    const newElements = elements.filter((el) => el.id !== id);
    setElements(newElements);
    pushHistory(newElements);
  };

  const handleTextDoubleClick = (element: WhiteboardElement) => {
    if (element.type !== "text") return;
    const stage = stageRef.current;
    if (!stage) return;

    // Get the stage container position
    const container = stage.container().getBoundingClientRect();
    setEditingTextId(element.id);
    setEditingTextValue(element.text ?? "Text");
    setEditingTextPos({
      x: container.left + element.x,
      y: container.top + element.y,
    });
  };

  const handleTextEditComplete = () => {
    if (!editingTextId) return;

    const newElements = elements.map((el) =>
      el.id === editingTextId ? { ...el, text: editingTextValue } : el,
    );
    setElements(newElements);
    pushHistory(newElements);
    setEditingTextId(null);
    setEditingTextValue("");
  };

  const renderElement = (element: WhiteboardElement) => {
    const commonProps = {
      id: element.id,
      key: element.id,
      x: element.x,
      y: element.y,
      rotation: element.rotation ?? 0,
      draggable: tool === "select",
      onClick: () => {
        if (tool === "eraser") {
          handleErase(element.id);
        } else {
          setSelectedId(element.id);
        }
      },
      onDragEnd: (e: KonvaEventObject<DragEvent>) =>
        handleDragEnd(element.id, e),
      onTransformEnd: (e: KonvaEventObject<unknown>) =>
        handleTransformEnd(element.id, e),
    };

    switch (element.type) {
      case "rect":
        return (
          <Rect
            {...commonProps}
            width={element.width ?? 100}
            height={element.height ?? 60}
            fill={element.fill ?? "#ffffff"}
            stroke={element.stroke ?? "#000000"}
            strokeWidth={2}
          />
        );
      case "circle":
        return (
          <Circle
            {...commonProps}
            radius={(element.width ?? 50) / 2}
            fill={element.fill ?? "#ffffff"}
            stroke={element.stroke ?? "#000000"}
            strokeWidth={2}
          />
        );
      case "arrow":
        return (
          <Arrow
            {...commonProps}
            points={element.points ?? [0, 0, 100, 0]}
            stroke={element.stroke ?? "#000000"}
            fill={element.stroke ?? "#000000"}
            strokeWidth={2}
            pointerLength={10}
            pointerWidth={10}
          />
        );
      case "text":
        return (
          <KonvaText
            {...commonProps}
            text={element.text ?? "Text"}
            fontSize={element.fontSize ?? 16}
            fill={element.stroke ?? "#000000"}
            onDblClick={() => handleTextDoubleClick(element)}
            onDblTap={() => handleTextDoubleClick(element)}
          />
        );
      case "line":
        return (
          <Line
            {...commonProps}
            points={element.points ?? []}
            stroke={element.stroke ?? "#000000"}
            strokeWidth={element.strokeWidth ?? 2}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
          />
        );
      case "task": {
        const task = acceptedTasks.find((t) => t.id === element.taskId);
        if (!task) return null;
        return (
          <WhiteboardTaskCard
            key={element.id}
            element={element}
            task={task}
            isSelected={selectedId === element.id}
            draggable={tool === "select"}
            onClick={() => {
              if (tool === "eraser") {
                handleErase(element.id);
              } else {
                setSelectedId(element.id);
              }
            }}
            onDblClick={() => handleTaskDblClick(task)}
            onDragEnd={(e) => handleDragEnd(element.id, e)}
          />
        );
      }
      default:
        return null;
    }
  };

  // Handle task update from drawer
  const handleTaskUpdate = (updatedTask: Task) => {
    setEditingTask(null);
    // Update the task in the accepted tasks list
    setAcceptedTasks(
      acceptedTasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
    );
  };

  // Handle double-click on task card
  const handleTaskDblClick = (task: Task) => {
    setEditingTask(task);
  };

  // Get tasks not yet on the whiteboard
  const tasksOnBoard = new Set(
    elements.filter((el) => el.type === "task").map((el) => el.taskId),
  );
  const availableTasks = acceptedTasks.filter((t) => !tasksOnBoard.has(t.id));

  // Check if selected element is a task (no resize, only move/rotate)
  const selectedElement = selectedId
    ? elements.find((el) => el.id === selectedId)
    : null;
  const isTaskSelected = selectedElement?.type === "task";

  const handleAddTask = (taskId: number, x?: number, y?: number) => {
    // Add task at specified position or center of visible canvas
    const newElement: WhiteboardElement = {
      id: crypto.randomUUID(),
      type: "task",
      x: x ?? stageSize.width / 2 - 100,
      y: y ?? stageSize.height / 2 - 20,
      taskId,
    };
    const newElements = [...elements, newElement];
    setElements(newElements);
    pushHistory(newElements);
  };

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z + 0.1, 2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z - 0.1, 0.5));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  // Panel resize handlers
  const handlePanelResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizingPanel(true);
      const startY = e.clientY;
      const startHeight = taskPanelHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = moveEvent.clientY - startY;
        setTaskPanelHeight(Math.max(100, Math.min(500, startHeight + deltaY)));
      };

      const handleMouseUp = () => {
        setIsResizingPanel(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [taskPanelHeight],
  );

  // Drag and drop from task selector
  const handleDragStart = useCallback((e: React.DragEvent, taskId: number) => {
    e.dataTransfer.setData("taskId", taskId.toString());
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const taskId = Number.parseInt(e.dataTransfer.getData("taskId"), 10);
      if (Number.isNaN(taskId)) return;

      // Check if task is already on board
      if (tasksOnBoard.has(taskId)) return;

      // Get drop position relative to canvas
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;

      const x = (e.clientX - canvasRect.left) / zoom - 110;
      const y = (e.clientY - canvasRect.top) / zoom - 24;

      handleAddTask(taskId, x, y);
    },
    [zoom, tasksOnBoard, handleAddTask],
  );

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  // Zoom keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        handleZoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        handleZoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        handleZoomReset();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  return (
    <Box h="100%" style={{ display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <Paper
        p="xs"
        withBorder={false}
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
          flexShrink: 0,
        }}
      >
        <Flex align="center" gap="xs">
          {/* Drawing tools */}
          <WhiteboardToolbar
            tool={tool}
            onToolChange={setTool}
            strokeColor={strokeColor}
            onStrokeColorChange={setStrokeColor}
            fillColor={fillColor}
            onFillColorChange={setFillColor}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
          />

          <Divider orientation="vertical" />

          {/* Save */}
          <Tooltip label="Save (Ctrl+S)">
            <ActionIcon
              variant={isDirty ? "filled" : "subtle"}
              color={isDirty ? "blue" : "gray"}
              size="md"
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              loading={isSaving}
            >
              <IconDeviceFloppy size={18} />
            </ActionIcon>
          </Tooltip>

          <Divider orientation="vertical" />

          {/* Help */}
          <Tooltip label="Help">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="md"
              onClick={openHelp}
            >
              <IconHelp size={18} />
            </ActionIcon>
          </Tooltip>
        </Flex>
      </Paper>

      {/* Main content */}
      <Box style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {/* Floating task panel on left */}
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
              borderBottom: isTaskPanelOpen
                ? "1px solid var(--mantine-color-default-border)"
                : "none",
            }}
            onClick={() => setIsTaskPanelOpen(!isTaskPanelOpen)}
          >
            <Text size="sm" fw={500}>
              Tasks ({availableTasks.length})
            </Text>
            <ActionIcon variant="subtle" size="xs">
              {isTaskPanelOpen ? (
                <IconChevronUp size={14} />
              ) : (
                <IconChevronDown size={14} />
              )}
            </ActionIcon>
          </Flex>

          {/* Collapsible content */}
          <Collapse in={isTaskPanelOpen}>
            <ScrollArea h={taskPanelHeight} p="xs" scrollbarSize={6}>
              <Flex direction="column" gap={4}>
                {availableTasks.length === 0 ? (
                  <Text size="xs" c="dimmed" ta="center" py="md">
                    All tasks on board
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
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onClick={() => handleAddTask(task.id)}
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
              onMouseDown={handlePanelResizeStart}
            >
              <IconGripHorizontal size={14} opacity={0.5} />
            </Flex>
          </Collapse>
        </Paper>

        {/* Canvas */}
        <Box
          ref={canvasRef}
          onDrop={handleCanvasDrop}
          onDragOver={handleCanvasDragOver}
          style={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
            cursor:
              tool === "eraser"
                ? "crosshair"
                : tool === "select"
                  ? "default"
                  : "crosshair",
          }}
        >
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            scaleX={zoom}
            scaleY={zoom}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ background: "var(--mantine-color-body)" }}
          >
            <Layer>
              {/* Grid pattern */}
              {Array.from({ length: Math.ceil(stageSize.width / 20) }).map(
                (_, i) => (
                  <Line
                    key={`v-${i}`}
                    points={[i * 20, 0, i * 20, stageSize.height]}
                    stroke="var(--mantine-color-default-border)"
                    strokeWidth={0.5}
                    opacity={0.5}
                  />
                ),
              )}
              {Array.from({ length: Math.ceil(stageSize.height / 20) }).map(
                (_, i) => (
                  <Line
                    key={`h-${i}`}
                    points={[0, i * 20, stageSize.width, i * 20]}
                    stroke="var(--mantine-color-default-border)"
                    strokeWidth={0.5}
                    opacity={0.5}
                  />
                ),
              )}

              {/* Render elements */}
              {elements.map(renderElement)}

              {/* Current drawing line */}
              {isDrawing && currentLine.length > 0 && (
                <Line
                  points={currentLine}
                  stroke={strokeColor}
                  strokeWidth={2}
                  tension={0.5}
                  lineCap="round"
                  lineJoin="round"
                />
              )}

              {/* Transformer */}
              <Transformer
                ref={transformerRef}
                enabledAnchors={
                  isTaskSelected
                    ? [] // No resize for tasks, only move/rotate
                    : [
                        "top-left",
                        "top-center",
                        "top-right",
                        "middle-right",
                        "middle-left",
                        "bottom-left",
                        "bottom-center",
                        "bottom-right",
                      ]
                }
                rotateEnabled={true}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 5 || newBox.height < 5) {
                    return oldBox;
                  }
                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        </Box>

        {/* Text editing overlay */}
        {editingTextId && (
          <TextInput
            autoFocus
            value={editingTextValue}
            onChange={(e) => setEditingTextValue(e.target.value)}
            onBlur={handleTextEditComplete}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleTextEditComplete();
              } else if (e.key === "Escape") {
                setEditingTextId(null);
                setEditingTextValue("");
              }
            }}
            style={{
              position: "fixed",
              left: editingTextPos.x,
              top: editingTextPos.y,
              zIndex: 100,
              minWidth: 100,
            }}
            styles={{
              input: {
                background: "var(--mantine-color-body)",
                border: "2px solid var(--mantine-color-blue-6)",
              },
            }}
          />
        )}

        {/* Zoom controls - bottom right */}
        <Paper
          radius="md"
          shadow="sm"
          withBorder
          p={4}
          className={classes.taskPanel}
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            zIndex: 10,
          }}
        >
          <Flex align="center" gap={4}>
            <Tooltip label="Zoom out (Ctrl+-)">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleZoomOut}
                disabled={zoom <= 0.5}
              >
                <IconMinus size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Reset zoom (Ctrl+0)">
              <Text
                size="xs"
                fw={500}
                style={{ cursor: "pointer", minWidth: 40, textAlign: "center" }}
                onClick={handleZoomReset}
              >
                {Math.round(zoom * 100)}%
              </Text>
            </Tooltip>
            <Tooltip label="Zoom in (Ctrl++)">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleZoomIn}
                disabled={zoom >= 2}
              >
                <IconPlus size={14} />
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Paper>
      </Box>

      {/* Help Modal */}
      <Modal
        opened={helpOpened}
        onClose={closeHelp}
        title="Draw Help"
        size="md"
      >
        <Text size="sm" fw={500} mb="xs">
          Tools
        </Text>
        <List size="sm" spacing={4} mb="md">
          <List.Item>
            <strong>Select</strong> - Click to select, drag to move
          </List.Item>
          <List.Item>
            <strong>Rectangle/Circle</strong> - Click to place shape
          </List.Item>
          <List.Item>
            <strong>Arrow</strong> - Click to place arrow
          </List.Item>
          <List.Item>
            <strong>Text</strong> - Click to add text, double-click to edit
          </List.Item>
          <List.Item>
            <strong>Draw</strong> - Freehand drawing
          </List.Item>
          <List.Item>
            <strong>Eraser</strong> - Click on elements to delete
          </List.Item>
        </List>

        <Text size="sm" fw={500} mb="xs">
          Tasks
        </Text>
        <List size="sm" spacing={4} mb="md">
          <List.Item>Click a task in the panel to add to center</List.Item>
          <List.Item>Drag a task from the panel to place it anywhere</List.Item>
          <List.Item>Tasks can be moved and rotated, but not resized</List.Item>
          <List.Item>Double-click a task to edit its details</List.Item>
        </List>

        <Text size="sm" fw={500} mb="xs">
          Keyboard Shortcuts
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <strong>Ctrl+S</strong> - Save whiteboard
          </List.Item>
          <List.Item>
            <strong>Ctrl+Z</strong> - Undo
          </List.Item>
          <List.Item>
            <strong>Ctrl+Shift+Z</strong> - Redo
          </List.Item>
          <List.Item>
            <strong>Ctrl++</strong> - Zoom in
          </List.Item>
          <List.Item>
            <strong>Ctrl+-</strong> - Zoom out
          </List.Item>
          <List.Item>
            <strong>Ctrl+0</strong> - Reset zoom
          </List.Item>
          <List.Item>
            <strong>Delete/Backspace</strong> - Delete selected element
          </List.Item>
          <List.Item>
            <strong>Escape</strong> - Deselect / cancel
          </List.Item>
        </List>
      </Modal>

      {/* Task Edit Drawer */}
      {project && (
        <Drawer
          title="Edit Task"
          size="xl"
          position="right"
          opened={!!editingTask}
          onClose={() => setEditingTask(null)}
        >
          {editingTask && (
            <Card withBorder radius="md">
              <TaskCreate
                project={project}
                task={editingTask}
                onSubmit={handleTaskUpdate}
              />
            </Card>
          )}
        </Drawer>
      )}
    </Box>
  );
};

export default WhiteboardCanvas;
