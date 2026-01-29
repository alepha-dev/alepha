import { useToast } from "@alepha/ui";
import {
  ActionIcon,
  Box,
  Card,
  Divider,
  Drawer,
  Flex,
  Paper,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDeviceFloppy, IconHelp } from "@tabler/icons-react";
import { useClient, useStore } from "alepha/react";
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
import type { WhiteboardController } from "../../../../../api/controllers/WhiteboardController.ts";
import type { Task } from "../../../../../api/entities/tasks.ts";
import type { WhiteboardElement } from "../../../../../api/entities/whiteboards.ts";
import { currentAssignedTasksAtom } from "../../../atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import TaskCreate from "../task/TaskCreate.tsx";
import CanvasGrid from "./CanvasGrid.tsx";
import CanvasImage from "./CanvasImage.tsx";
import CanvasMinimap from "./CanvasMinimap.tsx";
import HelpModal from "./HelpModal.tsx";
import TaskPanel from "./TaskPanel.tsx";
import type {
  KonvaEventObject,
  KonvaStage,
  KonvaTransformer,
  SelectionRect,
  ToolType,
  WhiteboardCanvasProps,
} from "./types.ts";
import { getElementBounds } from "./types.ts";
import ViewControls from "./ViewControls.tsx";
import WhiteboardTaskCard from "./WhiteboardTaskCard.tsx";
import WhiteboardToolbar from "./WhiteboardToolbar.tsx";

const WhiteboardCanvas = ({ whiteboard, onSave }: WhiteboardCanvasProps) => {
  const toast = useToast();
  const whiteboardApi = useClient<WhiteboardController>();
  const [project] = useStore(currentProjectAtom);
  const [acceptedTasks, setAcceptedTasks] = useStore(currentAssignedTasksAtom);
  const stageRef = useRef<KonvaStage>(null);
  const transformerRef = useRef<KonvaTransformer>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [helpOpened, { open: openHelp, close: closeHelp }] =
    useDisclosure(false);

  // Canvas state
  const [elements, setElements] = useState<WhiteboardElement[]>(
    whiteboard.data.elements,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<ToolType>("select");
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(
    null,
  );
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
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState("");
  const [editingTextPos, setEditingTextPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPointerPos, setLastPointerPos] = useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Update elements when whiteboard changes
  useEffect(() => {
    setElements(whiteboard.data.elements);
    setHistory([whiteboard.data.elements]);
    setHistoryIndex(0);
    setIsDirty(false);
  }, [whiteboard.id]);

  // Resize stage to fit container
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
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length > 0) {
          for (const id of selectedIds) {
            const element = elements.find((el) => el.id === id);
            if (element?.type === "image" && element.fileId) {
              try {
                await whiteboardApi.deleteImage({
                  params: { fileId: element.fileId },
                });
              } catch {
                // Silent fail
              }
            }
          }
          const newElements = elements.filter(
            (el) => !selectedIds.includes(el.id),
          );
          setElements(newElements);
          pushHistory(newElements);
          setSelectedIds([]);
        }
      } else if (e.key === "Escape") {
        setSelectedIds([]);
        setTool("select");
      } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedIds(elements.map((el) => el.id));
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
  }, [
    selectedIds,
    elements,
    pushHistory,
    handleUndo,
    handleRedo,
    handleSave,
    whiteboardApi,
  ]);

  // Update transformer on selection change
  useEffect(() => {
    if (transformerRef.current && stageRef.current) {
      if (selectedIds.length > 0) {
        const nodes = selectedIds
          .map((id) => stageRef.current?.findOne(`#${id}`))
          .filter(Boolean);
        transformerRef.current.nodes(nodes as never[]);
        transformerRef.current.getLayer()?.batchDraw();
      } else {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    }
  }, [selectedIds]);

  const generateId = () => crypto.randomUUID();

  const getPointerPosition = () => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    return {
      x: (pos.x - stagePos.x) / zoom,
      y: (pos.y - stagePos.y) / zoom,
    };
  };

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage();

    if (tool === "select") {
      if (clickedOnEmpty) {
        const pos = getPointerPosition();
        setIsSelecting(true);
        setSelectionStart(pos);
        setSelectionRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
        if (!e.evt.shiftKey) {
          setSelectedIds([]);
        }
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
    setSelectedIds([newElement.id]);
    setTool("select");
  };

  const handleMouseMove = () => {
    const pos = getPointerPosition();

    if (isSelecting) {
      const x = Math.min(selectionStart.x, pos.x);
      const y = Math.min(selectionStart.y, pos.y);
      const width = Math.abs(pos.x - selectionStart.x);
      const height = Math.abs(pos.y - selectionStart.y);
      setSelectionRect({ x, y, width, height });
      return;
    }

    if (!isDrawing || tool !== "line") return;
    setCurrentLine([...currentLine, pos.x, pos.y]);
  };

  const getElementsInRect = (rect: SelectionRect) => {
    return elements.filter((el) => {
      const bounds = getElementBounds(el);
      return !(
        bounds.x > rect.x + rect.width ||
        bounds.x + bounds.width < rect.x ||
        bounds.y > rect.y + rect.height ||
        bounds.y + bounds.height < rect.y
      );
    });
  };

  const handleMouseUp = () => {
    if (isSelecting && selectionRect) {
      if (selectionRect.width > 5 || selectionRect.height > 5) {
        const elementsInRect = getElementsInRect(selectionRect);
        const newIds = elementsInRect.map((el) => el.id);
        setSelectedIds((prev) => [...new Set([...prev, ...newIds])]);
      }
      setIsSelecting(false);
      setSelectionRect(null);
      return;
    }

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
      scaleX: { (): number; (v: number): void };
      scaleY: { (): number; (v: number): void };
    };
    const element = elements.find((el) => el.id === id);
    if (!element) return;

    const scaleX = target.scaleX();
    const scaleY = target.scaleY();

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

      if (el.type === "arrow" && el.points) {
        const scaledPoints = el.points.map((p, i) =>
          i % 2 === 0 ? p * scaleX : p * scaleY,
        );
        return { ...baseUpdate, points: scaledPoints };
      } else if (el.type === "text") {
        const newFontSize = Math.max(
          8,
          (el.fontSize ?? 16) * Math.max(scaleX, scaleY),
        );
        return { ...baseUpdate, fontSize: newFontSize };
      } else if (el.type === "line" && el.points) {
        const scaledPoints = el.points.map((p, i) =>
          i % 2 === 0 ? p * scaleX : p * scaleY,
        );
        return { ...baseUpdate, points: scaledPoints };
      } else {
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

  const handleErase = async (id: string) => {
    if (tool !== "eraser") return;

    const element = elements.find((el) => el.id === id);
    if (element?.type === "image" && element.fileId) {
      try {
        await whiteboardApi.deleteImage({
          params: { fileId: element.fileId },
        });
      } catch {
        // Silent fail
      }
    }

    const newElements = elements.filter((el) => el.id !== id);
    setElements(newElements);
    pushHistory(newElements);
  };

  const uploadAndPlaceImage = useCallback(
    async (file: File) => {
      const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!validTypes.includes(file.type)) {
        toast.danger({ message: "Invalid image type" });
        return;
      }

      setIsUploadingImage(true);
      try {
        const result = await whiteboardApi.uploadImage({
          body: { file },
        });

        const centerX = (stageSize.width / 2 - stagePos.x) / zoom - 100;
        const centerY = (stageSize.height / 2 - stagePos.y) / zoom - 75;

        const newElement: WhiteboardElement = {
          id: generateId(),
          type: "image",
          x: centerX,
          y: centerY,
          width: 200,
          height: 150,
          fileId: result.fileId,
        };

        const newElements = [...elements, newElement];
        setElements(newElements);
        pushHistory(newElements);
        setSelectedIds([newElement.id]);

        toast.success({ message: "Image added" });
      } catch (error) {
        toast.danger({ message: "Failed to upload image" });
      } finally {
        setIsUploadingImage(false);
      }
    },
    [whiteboardApi, stageSize, stagePos, zoom, elements, pushHistory, toast],
  );

  const handleImageUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      uploadAndPlaceImage(file);
    },
    [uploadAndPlaceImage],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await uploadAndPlaceImage(file);
          }
          return;
        }
      }
    },
    [uploadAndPlaceImage],
  );

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleTextDoubleClick = (element: WhiteboardElement) => {
    if (element.type !== "text") return;
    const stage = stageRef.current;
    if (!stage) return;

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

  const handleElementSelect = (
    elementId: string,
    e: KonvaEventObject<MouseEvent>,
  ) => {
    if (tool === "eraser") {
      handleErase(elementId);
      return;
    }

    if (tool !== "select") {
      return;
    }

    if (e.evt.shiftKey) {
      if (selectedIds.includes(elementId)) {
        setSelectedIds(selectedIds.filter((id) => id !== elementId));
      } else {
        setSelectedIds([...selectedIds, elementId]);
      }
    } else {
      setSelectedIds([elementId]);
    }
  };

  const renderElement = (element: WhiteboardElement) => {
    const handleClick = (e: KonvaEventObject<MouseEvent>) => {
      handleElementSelect(element.id, e);
    };

    const handleTap = () => {
      if (tool === "eraser") {
        handleErase(element.id);
      } else if (tool === "select") {
        setSelectedIds([element.id]);
      }
    };

    const commonProps = {
      id: element.id,
      key: element.id,
      x: element.x,
      y: element.y,
      rotation: element.rotation ?? 0,
      draggable: tool === "select",
      onClick: handleClick,
      onTap: handleTap,
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
            hitStrokeWidth={20}
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
            hitStrokeWidth={20}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
          />
        );
      case "image": {
        if (!element.fileId) return null;
        return (
          <CanvasImage
            key={element.id}
            element={element}
            isSelected={selectedIds.includes(element.id)}
            tool={tool}
            onSelect={(e) => handleElementSelect(element.id, e)}
            onErase={() => handleErase(element.id)}
            onDragEnd={(e) => handleDragEnd(element.id, e)}
            onTransformEnd={(e) => handleTransformEnd(element.id, e)}
          />
        );
      }
      case "task": {
        const task = acceptedTasks.find((t) => t.id === element.taskId);
        if (!task) return null;
        return (
          <WhiteboardTaskCard
            key={element.id}
            element={element}
            task={task}
            isSelected={selectedIds.includes(element.id)}
            draggable={tool === "select"}
            onClick={(e) => {
              if (tool === "eraser") {
                handleErase(element.id);
              } else {
                handleElementSelect(element.id, e);
              }
            }}
            onTap={() => {
              if (tool === "eraser") {
                handleErase(element.id);
              } else if (tool === "select") {
                setSelectedIds([element.id]);
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

  const handleTaskUpdate = (updatedTask: Task) => {
    setEditingTask(null);
    setAcceptedTasks(
      acceptedTasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
    );
  };

  const handleTaskDblClick = (task: Task) => {
    setEditingTask(task);
  };

  const tasksOnBoard = new Set(
    elements.filter((el) => el.type === "task").map((el) => el.taskId),
  );
  const availableTasks = acceptedTasks.filter((t) => !tasksOnBoard.has(t.id));

  const hasTaskSelected = selectedIds.some((id) => {
    const el = elements.find((e) => e.id === id);
    return el?.type === "task";
  });

  const handleAddTask = (taskId: number, x?: number, y?: number) => {
    const centerX = x ?? (stageSize.width / 2 - stagePos.x) / zoom - 110;
    const centerY = y ?? (stageSize.height / 2 - stagePos.y) / zoom - 24;

    const newElement: WhiteboardElement = {
      id: crypto.randomUUID(),
      type: "task",
      x: centerX,
      y: centerY,
      taskId,
    };
    const newElements = [...elements, newElement];
    setElements(newElements);
    pushHistory(newElements);
  };

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z + 0.1, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z - 0.1, 0.1));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setStagePos({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      if (e.evt.ctrlKey || e.evt.metaKey) {
        const oldScale = zoom;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const scaleBy = 1.1;
        const newScale =
          e.evt.deltaY > 0
            ? Math.max(0.1, oldScale / scaleBy)
            : Math.min(3, oldScale * scaleBy);

        const mousePointTo = {
          x: (pointer.x - stagePos.x) / oldScale,
          y: (pointer.y - stagePos.y) / oldScale,
        };

        const newPos = {
          x: pointer.x - mousePointTo.x * newScale,
          y: pointer.y - mousePointTo.y * newScale,
        };

        setZoom(newScale);
        setStagePos(newPos);
      } else {
        setStagePos({
          x: stagePos.x - e.evt.deltaX,
          y: stagePos.y - e.evt.deltaY,
        });
      }
    },
    [zoom, stagePos],
  );

  const handlePanStart = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1 || (e.evt.button === 0 && spacePressed)) {
        e.evt.preventDefault();
        setIsPanning(true);
        setLastPointerPos({ x: e.evt.clientX, y: e.evt.clientY });
      }
    },
    [spacePressed],
  );

  const handlePanMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (!isPanning) return;

      const dx = e.evt.clientX - lastPointerPos.x;
      const dy = e.evt.clientY - lastPointerPos.y;

      setStagePos({
        x: stagePos.x + dx,
        y: stagePos.y + dy,
      });
      setLastPointerPos({ x: e.evt.clientX, y: e.evt.clientY });
    },
    [isPanning, lastPointerPos, stagePos],
  );

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleFitToContent = useCallback(() => {
    if (elements.length === 0) {
      setStagePos({ x: 0, y: 0 });
      setZoom(1);
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const el of elements) {
      const x = el.x;
      const y = el.y;
      const width = el.width ?? (el.type === "task" ? 220 : 100);
      const height = el.height ?? (el.type === "task" ? 48 : 60);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }

    const padding = 50;
    const contentWidth = maxX - minX + padding * 2;
    const contentHeight = maxY - minY + padding * 2;

    const scaleX = stageSize.width / contentWidth;
    const scaleY = stageSize.height / contentHeight;
    const newScale = Math.min(scaleX, scaleY, 2);

    const newX =
      (stageSize.width - contentWidth * newScale) / 2 -
      (minX - padding) * newScale;
    const newY =
      (stageSize.height - contentHeight * newScale) / 2 -
      (minY - padding) * newScale;

    setZoom(newScale);
    setStagePos({ x: newX, y: newY });
  }, [elements, stageSize]);

  const handleDragStart = useCallback((e: React.DragEvent, taskId: number) => {
    e.dataTransfer.setData("taskId", taskId.toString());
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const taskId = Number.parseInt(e.dataTransfer.getData("taskId"), 10);
      if (Number.isNaN(taskId)) return;

      if (tasksOnBoard.has(taskId)) return;

      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;

      const screenX = e.clientX - canvasRect.left;
      const screenY = e.clientY - canvasRect.top;
      const x = (screenX - stagePos.x) / zoom - 110;
      const y = (screenY - stagePos.y) / zoom - 24;

      handleAddTask(taskId, x, y);
    },
    [zoom, stagePos, tasksOnBoard, handleAddTask],
  );

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  // Zoom and navigation keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
      }
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

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
        setIsPanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
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
            onImageUpload={handleImageUpload}
            isUploadingImage={isUploadingImage}
          />

          <Divider orientation="vertical" />

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
        {/* Floating task panel */}
        <TaskPanel
          availableTasks={availableTasks}
          onAddTask={handleAddTask}
          onDragStart={handleDragStart}
        />

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
              isPanning || spacePressed
                ? isPanning
                  ? "grabbing"
                  : "grab"
                : tool === "eraser"
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
            x={stagePos.x}
            y={stagePos.y}
            scaleX={zoom}
            scaleY={zoom}
            onWheel={handleWheel}
            onMouseDown={(e) => {
              handlePanStart(e);
              if (!isPanning && !spacePressed && e.evt.button === 0) {
                handleMouseDown(e);
              }
            }}
            onMouseMove={(e) => {
              handlePanMove(e);
              if (!isPanning) {
                handleMouseMove();
              }
            }}
            onMouseUp={() => {
              handlePanEnd();
              handleMouseUp();
            }}
            onMouseLeave={() => {
              handlePanEnd();
              handleMouseUp();
            }}
            style={{ background: "var(--mantine-color-body)" }}
          >
            <Layer>
              <CanvasGrid
                stagePos={stagePos}
                stageSize={stageSize}
                zoom={zoom}
              />

              {elements.map(renderElement)}

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

              {isSelecting && selectionRect && (
                <Rect
                  x={selectionRect.x}
                  y={selectionRect.y}
                  width={selectionRect.width}
                  height={selectionRect.height}
                  fill="rgba(34, 139, 230, 0.1)"
                  stroke="#228be6"
                  strokeWidth={1}
                  dash={[4, 4]}
                />
              )}

              <Transformer
                ref={transformerRef}
                enabledAnchors={
                  hasTaskSelected
                    ? []
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

        {/* Mini-map */}
        <CanvasMinimap
          elements={elements}
          stagePos={stagePos}
          stageSize={stageSize}
          zoom={zoom}
        />

        {/* View controls */}
        <ViewControls
          zoom={zoom}
          spacePressed={spacePressed}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
          onFitToContent={handleFitToContent}
          onSetZoom={setZoom}
        />
      </Box>

      {/* Help Modal */}
      <HelpModal opened={helpOpened} onClose={closeHelp} />

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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={handleFileSelect}
      />
    </Box>
  );
};

export default WhiteboardCanvas;
