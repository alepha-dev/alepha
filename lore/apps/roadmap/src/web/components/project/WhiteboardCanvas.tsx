import { useAlepha, useClient, useStore } from "@alepha/react";
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
  IconFocusCentered,
  IconGripHorizontal,
  IconHandStop,
  IconHelp,
  IconHome,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Arrow,
  Circle,
  Image as KonvaImage,
  Text as KonvaText,
  Layer,
  Line,
  Rect,
  Stage,
  Transformer,
} from "react-konva";
import type { WhiteboardController } from "../../../api/controllers/WhiteboardController.ts";
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

// Separate component for canvas images - handles its own loading state
// This ensures proper re-render when image loads (Konva doesn't detect Map changes)
interface CanvasImageProps {
  element: WhiteboardElement;
  isSelected: boolean;
  tool: ToolType;
  onSelect: (e: KonvaEventObject<MouseEvent>) => void;
  onErase: () => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: KonvaEventObject<unknown>) => void;
}

const CanvasImage = ({
  element,
  isSelected,
  tool,
  onSelect,
  onErase,
  onDragEnd,
  onTransformEnd,
}: CanvasImageProps) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!element.fileId) return;

    // Reset state when fileId changes
    setImage(null);
    setError(false);

    const img = new window.Image();
    img.onload = async () => {
      try {
        // Wait for image to be fully decoded (ready for canvas)
        await img.decode();
        setImage(img);
      } catch (e) {
        console.error("Failed to decode image:", element.fileId, e);
        setError(true);
      }
    };
    img.onerror = (e) => {
      console.error("Failed to load image:", element.fileId, e);
      setError(true);
    };
    img.src = `/api/files/${element.fileId}`;
  }, [element.fileId]);

  const commonProps = {
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation ?? 0,
    draggable: tool === "select",
    onClick: (e: KonvaEventObject<MouseEvent>) => {
      if (tool === "eraser") {
        onErase();
      } else {
        onSelect(e);
      }
    },
    onDragEnd,
    onTransformEnd,
  };

  if (!image) {
    // Show placeholder while loading or error state
    return (
      <Rect
        {...commonProps}
        width={element.width ?? 200}
        height={element.height ?? 150}
        fill={error ? "#ffcccc" : "#f0f0f0"}
        stroke={error ? "#cc0000" : "#ccc"}
        strokeWidth={1}
      />
    );
  }

  return (
    <KonvaImage
      {...commonProps}
      image={image}
      width={element.width ?? 200}
      height={element.height ?? 150}
    />
  );
};

const WhiteboardCanvas = ({ whiteboard, onSave }: WhiteboardCanvasProps) => {
  const alepha = useAlepha();
  const toast = useToast();
  const dialog = useDialog();
  const whiteboardApi = useClient<WhiteboardController>();
  const [project] = useStore(currentProjectAtom);
  const [acceptedTasks, setAcceptedTasks] = useStore(currentAssignedTasksAtom);
  const stageRef = useRef<KonvaStage>(null);
  const transformerRef = useRef<KonvaTransformer>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [helpOpened, { open: openHelp, close: closeHelp }] =
    useDisclosure(false);

  const [elements, setElements] = useState<WhiteboardElement[]>(
    whiteboard.data.elements,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<ToolType>("select");
  // Selection rectangle (marquee) state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState({ x: 0, y: 0 });
  const [selectionRect, setSelectionRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
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
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPointerPos, setLastPointerPos] = useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [taskPanelHeight, setTaskPanelHeight] = useState(300);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
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
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length > 0) {
          // Delete all selected elements, cleanup images from storage
          for (const id of selectedIds) {
            const element = elements.find((el) => el.id === id);
            if (element?.type === "image" && element.fileId) {
              try {
                await whiteboardApi.deleteImage({
                  params: { fileId: element.fileId },
                });
              } catch {
                // Silent fail - file might already be deleted
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
        // Select all
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

  // Get pointer position in canvas coordinates (accounting for pan and zoom)
  const getPointerPosition = () => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pos = stage.getPointerPosition();
    if (!pos) return { x: 0, y: 0 };
    // Convert screen coordinates to canvas coordinates
    return {
      x: (pos.x - stagePos.x) / zoom,
      y: (pos.y - stagePos.y) / zoom,
    };
  };

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const clickedOnEmpty = e.target === e.target.getStage();

    if (tool === "select") {
      if (clickedOnEmpty) {
        // Start selection rectangle (marquee)
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
    setSelectedIds([newElement.id]);
    setTool("select");
  };

  const handleMouseMove = () => {
    const pos = getPointerPosition();

    // Update selection rectangle
    if (isSelecting) {
      const x = Math.min(selectionStart.x, pos.x);
      const y = Math.min(selectionStart.y, pos.y);
      const width = Math.abs(pos.x - selectionStart.x);
      const height = Math.abs(pos.y - selectionStart.y);
      setSelectionRect({ x, y, width, height });
      return;
    }

    // Freehand drawing
    if (!isDrawing || tool !== "line") return;
    setCurrentLine([...currentLine, pos.x, pos.y]);
  };

  // Calculate element bounds for intersection testing
  const getElementBounds = (el: WhiteboardElement) => {
    let x = el.x;
    let y = el.y;
    let width: number;
    let height: number;

    switch (el.type) {
      case "task":
        width = el.width ?? 220;
        height = 48;
        break;
      case "image":
        width = el.width ?? 200;
        height = el.height ?? 150;
        break;
      case "rect":
        width = el.width ?? 100;
        height = el.height ?? 60;
        break;
      case "circle": {
        const radius = (el.width ?? 50) / 2;
        // Circle x,y is center, so adjust
        x = el.x - radius;
        y = el.y - radius;
        width = radius * 2;
        height = radius * 2;
        break;
      }
      case "arrow":
      case "line": {
        // Calculate bounds from points
        const points = el.points ?? [0, 0, 100, 0];
        let minX = el.x;
        let minY = el.y;
        let maxX = el.x;
        let maxY = el.y;
        for (let i = 0; i < points.length; i += 2) {
          const px = el.x + points[i];
          const py = el.y + points[i + 1];
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
        }
        x = minX;
        y = minY;
        width = Math.max(maxX - minX, 10);
        height = Math.max(maxY - minY, 10);
        break;
      }
      case "text": {
        // Approximate text size
        const textLen = (el.text?.length ?? 4) * ((el.fontSize ?? 16) * 0.6);
        width = Math.max(textLen, 20);
        height = (el.fontSize ?? 16) * 1.2;
        break;
      }
      default:
        width = 100;
        height = 60;
    }

    return { x, y, width, height };
  };

  // Get elements intersecting with a rectangle
  const getElementsInRect = (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    return elements.filter((el) => {
      const bounds = getElementBounds(el);

      // Check intersection
      return !(
        bounds.x > rect.x + rect.width ||
        bounds.x + bounds.width < rect.x ||
        bounds.y > rect.y + rect.height ||
        bounds.y + bounds.height < rect.y
      );
    });
  };

  const handleMouseUp = () => {
    // Finish selection rectangle
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

    // Finish freehand drawing
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

  const handleErase = async (id: string) => {
    if (tool !== "eraser") return;

    // Check if this is an image element - if so, delete from storage
    const element = elements.find((el) => el.id === id);
    if (element?.type === "image" && element.fileId) {
      try {
        await whiteboardApi.deleteImage({
          params: { fileId: element.fileId },
        });
      } catch {
        // Silent fail - file might already be deleted
      }
    }

    const newElements = elements.filter((el) => el.id !== id);
    setElements(newElements);
    pushHistory(newElements);
  };

  // Handle image upload - shared logic for file input and paste
  const uploadAndPlaceImage = useCallback(
    async (file: File) => {
      // Validate file type
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

        // Get center position for the new image
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

  // Handle paste from clipboard
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

  // Register paste listener
  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

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

  // Handle element selection with shift+click support
  const handleElementSelect = (
    elementId: string,
    e: KonvaEventObject<MouseEvent>,
  ) => {
    if (tool === "eraser") {
      handleErase(elementId);
      return;
    }

    // Only allow selection in select mode
    if (tool !== "select") {
      return;
    }

    if (e.evt.shiftKey) {
      // Toggle selection
      if (selectedIds.includes(elementId)) {
        setSelectedIds(selectedIds.filter((id) => id !== elementId));
      } else {
        setSelectedIds([...selectedIds, elementId]);
      }
    } else {
      // Single select
      setSelectedIds([elementId]);
    }
  };

  const renderElement = (element: WhiteboardElement) => {
    const handleClick = (e: KonvaEventObject<MouseEvent>) => {
      handleElementSelect(element.id, e);
    };

    // For tap events, we don't have shiftKey, so just single-select
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
      onTap: handleTap, // Touch support
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
              } else {
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

  // Check if any selected element is a task (no resize for tasks)
  const hasTaskSelected = selectedIds.some((id) => {
    const el = elements.find((e) => e.id === id);
    return el?.type === "task";
  });

  const handleAddTask = (taskId: number, x?: number, y?: number) => {
    // Add task at specified position or center of visible canvas
    // If no position specified, calculate center in canvas coordinates
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

  // Wheel handler for pan and zoom
  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      if (e.evt.ctrlKey || e.evt.metaKey) {
        // Zoom toward cursor
        const oldScale = zoom;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const scaleBy = 1.1;
        const newScale =
          e.evt.deltaY > 0
            ? Math.max(0.1, oldScale / scaleBy)
            : Math.min(3, oldScale * scaleBy);

        // Calculate new position to zoom toward pointer
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
        // Pan
        setStagePos({
          x: stagePos.x - e.evt.deltaX,
          y: stagePos.y - e.evt.deltaY,
        });
      }
    },
    [zoom, stagePos],
  );

  // Pan handlers
  const handlePanStart = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      // Middle mouse button (1) or space + left click (0)
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

  // Fit to content
  const handleFitToContent = useCallback(() => {
    if (elements.length === 0) {
      setStagePos({ x: 0, y: 0 });
      setZoom(1);
      return;
    }

    // Calculate bounding box of all elements
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

    // Calculate scale to fit
    const scaleX = stageSize.width / contentWidth;
    const scaleY = stageSize.height / contentHeight;
    const newScale = Math.min(scaleX, scaleY, 2); // Cap at 2x

    // Calculate position to center
    const newX =
      (stageSize.width - contentWidth * newScale) / 2 -
      (minX - padding) * newScale;
    const newY =
      (stageSize.height - contentHeight * newScale) / 2 -
      (minY - padding) * newScale;

    setZoom(newScale);
    setStagePos({ x: newX, y: newY });
  }, [elements, stageSize]);

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

      // Get drop position relative to canvas, accounting for pan and zoom
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;

      // Convert screen coordinates to canvas coordinates
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
      // Space key for panning mode
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
      }
      // Zoom shortcuts
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
            onImageUpload={handleImageUpload}
            isUploadingImage={isUploadingImage}
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
              Quests ({availableTasks.length})
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
                    All quests on board
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
              {/* Infinite grid pattern - calculated based on viewport */}
              {(() => {
                const gridSize = 20;
                // Calculate visible area in canvas coordinates
                const startX =
                  Math.floor(-stagePos.x / zoom / gridSize) * gridSize;
                const startY =
                  Math.floor(-stagePos.y / zoom / gridSize) * gridSize;
                const endX = startX + stageSize.width / zoom + gridSize * 2;
                const endY = startY + stageSize.height / zoom + gridSize * 2;

                const verticalLines = [];
                const horizontalLines = [];

                for (let x = startX; x <= endX; x += gridSize) {
                  verticalLines.push(
                    <Line
                      key={`v-${x}`}
                      points={[x, startY, x, endY]}
                      stroke="var(--mantine-color-default-border)"
                      strokeWidth={0.5 / zoom}
                      opacity={0.5}
                    />,
                  );
                }

                for (let y = startY; y <= endY; y += gridSize) {
                  horizontalLines.push(
                    <Line
                      key={`h-${y}`}
                      points={[startX, y, endX, y]}
                      stroke="var(--mantine-color-default-border)"
                      strokeWidth={0.5 / zoom}
                      opacity={0.5}
                    />,
                  );
                }

                return [...verticalLines, ...horizontalLines];
              })()}

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

              {/* Selection rectangle (marquee) */}
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

              {/* Transformer */}
              <Transformer
                ref={transformerRef}
                enabledAnchors={
                  hasTaskSelected
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

        {/* Mini-map - bottom right */}
        <Paper
          radius="md"
          shadow="sm"
          withBorder
          className={classes.taskPanel}
          style={{
            position: "absolute",
            bottom: 70,
            right: 16,
            zIndex: 10,
            width: 150,
            height: 100,
            overflow: "hidden",
            background: "var(--mantine-color-body)",
          }}
        >
          {(() => {
            // Calculate bounds of all elements
            if (elements.length === 0) {
              return (
                <Flex h="100%" align="center" justify="center">
                  <Text size="xs" c="dimmed">
                    Empty canvas
                  </Text>
                </Flex>
              );
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

            // Add padding
            const padding = 50;
            minX -= padding;
            minY -= padding;
            maxX += padding;
            maxY += padding;

            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;

            // Calculate scale to fit in mini-map
            const mapWidth = 150;
            const mapHeight = 100;
            const scale = Math.min(
              mapWidth / contentWidth,
              mapHeight / contentHeight,
              1,
            );

            // Calculate viewport rectangle
            const viewX = (-stagePos.x / zoom - minX) * scale;
            const viewY = (-stagePos.y / zoom - minY) * scale;
            const viewW = (stageSize.width / zoom) * scale;
            const viewH = (stageSize.height / zoom) * scale;

            return (
              <Box
                style={{ position: "relative", width: "100%", height: "100%" }}
              >
                {/* Elements as dots */}
                {elements.map((el) => {
                  const x = (el.x - minX) * scale;
                  const y = (el.y - minY) * scale;
                  const w = Math.max(
                    3,
                    (el.width ?? (el.type === "task" ? 220 : 50)) * scale,
                  );
                  const h = Math.max(
                    2,
                    (el.height ?? (el.type === "task" ? 48 : 50)) * scale,
                  );
                  return (
                    <Box
                      key={el.id}
                      style={{
                        position: "absolute",
                        left: x,
                        top: y,
                        width: w,
                        height: h,
                        background:
                          el.type === "task"
                            ? "var(--mantine-color-blue-6)"
                            : "var(--mantine-color-gray-6)",
                        borderRadius: 1,
                      }}
                    />
                  );
                })}
                {/* Viewport rectangle */}
                <Box
                  style={{
                    position: "absolute",
                    left: viewX,
                    top: viewY,
                    width: viewW,
                    height: viewH,
                    border: "1px solid var(--mantine-color-blue-5)",
                    background: "rgba(34, 139, 230, 0.1)",
                    pointerEvents: "none",
                  }}
                />
              </Box>
            );
          })()}
        </Paper>

        {/* View controls - bottom right */}
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
            <Tooltip label="Reset view (Ctrl+0)">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleZoomReset}
              >
                <IconHome size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Fit to content">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleFitToContent}
              >
                <IconFocusCentered size={14} />
              </ActionIcon>
            </Tooltip>
            <Divider orientation="vertical" />
            <Tooltip label="Zoom out (Ctrl+-)">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleZoomOut}
                disabled={zoom <= 0.1}
              >
                <IconMinus size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Click to reset zoom">
              <Text
                size="xs"
                fw={500}
                style={{ cursor: "pointer", minWidth: 40, textAlign: "center" }}
                onClick={() => setZoom(1)}
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
                disabled={zoom >= 3}
              >
                <IconPlus size={14} />
              </ActionIcon>
            </Tooltip>
            {spacePressed && (
              <>
                <Divider orientation="vertical" />
                <Tooltip label="Panning mode active">
                  <IconHandStop size={14} opacity={0.6} />
                </Tooltip>
              </>
            )}
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
            <strong>Select</strong> - Click to select, Shift+click to
            multi-select, drag empty space to marquee select
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
            <strong>Image</strong> - Upload images or paste from clipboard
            (Ctrl+V)
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
          Navigation
        </Text>
        <List size="sm" spacing={4} mb="md">
          <List.Item>
            <strong>Scroll/Trackpad</strong> - Pan the canvas
          </List.Item>
          <List.Item>
            <strong>Ctrl+Scroll</strong> - Zoom toward cursor
          </List.Item>
          <List.Item>
            <strong>Space+Drag</strong> - Pan the canvas
          </List.Item>
          <List.Item>
            <strong>Middle mouse+Drag</strong> - Pan the canvas
          </List.Item>
          <List.Item>
            <strong>Mini-map</strong> - Shows current viewport position
          </List.Item>
        </List>

        <Text size="sm" fw={500} mb="xs">
          Keyboard Shortcuts
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <strong>Ctrl+S</strong> - Save drawing
          </List.Item>
          <List.Item>
            <strong>Ctrl+Z</strong> - Undo
          </List.Item>
          <List.Item>
            <strong>Ctrl+Shift+Z</strong> - Redo
          </List.Item>
          <List.Item>
            <strong>Ctrl+A</strong> - Select all elements
          </List.Item>
          <List.Item>
            <strong>Ctrl++</strong> - Zoom in
          </List.Item>
          <List.Item>
            <strong>Ctrl+-</strong> - Zoom out
          </List.Item>
          <List.Item>
            <strong>Ctrl+0</strong> - Reset view (zoom and position)
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

      {/* Hidden file input for image upload */}
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
