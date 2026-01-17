import { Line } from "react-konva";
import type { Position, Size } from "./types.ts";

export interface CanvasGridProps {
  stagePos: Position;
  stageSize: Size;
  zoom: number;
  gridSize?: number;
}

const CanvasGrid = ({
  stagePos,
  stageSize,
  zoom,
  gridSize = 20,
}: CanvasGridProps) => {
  // Calculate visible area in canvas coordinates
  const startX = Math.floor(-stagePos.x / zoom / gridSize) * gridSize;
  const startY = Math.floor(-stagePos.y / zoom / gridSize) * gridSize;
  const endX = startX + stageSize.width / zoom + gridSize * 2;
  const endY = startY + stageSize.height / zoom + gridSize * 2;

  const lines: React.ReactNode[] = [];

  // Vertical lines
  for (let x = startX; x <= endX; x += gridSize) {
    lines.push(
      <Line
        key={`v-${x}`}
        points={[x, startY, x, endY]}
        stroke="var(--mantine-color-default-border)"
        strokeWidth={0.5 / zoom}
        opacity={0.5}
      />,
    );
  }

  // Horizontal lines
  for (let y = startY; y <= endY; y += gridSize) {
    lines.push(
      <Line
        key={`h-${y}`}
        points={[startX, y, endX, y]}
        stroke="var(--mantine-color-default-border)"
        strokeWidth={0.5 / zoom}
        opacity={0.5}
      />,
    );
  }

  return <>{lines}</>;
};

export default CanvasGrid;
