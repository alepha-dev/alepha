import { useEffect, useState } from "react";
import { Image as KonvaImage, Rect } from "react-konva";
import type { WhiteboardElement } from "../../../../../api/entities/whiteboards.ts";
import type { KonvaEventObject, ToolType } from "./types.ts";

export interface CanvasImageProps {
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
      } else if (tool === "select") {
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

export default CanvasImage;
