import type { Stage, Transformer } from "react-konva";
import type {
  Whiteboard,
  WhiteboardData,
  WhiteboardElement,
} from "@/api/entities/whiteboards.ts";

// Konva types
export type KonvaStage = React.ComponentRef<typeof Stage>;
export type KonvaTransformer = React.ComponentRef<typeof Transformer>;

export interface KonvaEventObject<T> {
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

export type ToolType =
  | "select"
  | "rect"
  | "circle"
  | "arrow"
  | "text"
  | "line"
  | "image"
  | "eraser";

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

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Helper to calculate element bounds for intersection testing
export const getElementBounds = (el: WhiteboardElement): ElementBounds => {
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
      x = el.x - radius;
      y = el.y - radius;
      width = radius * 2;
      height = radius * 2;
      break;
    }
    case "arrow":
    case "line": {
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
