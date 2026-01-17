import { Group, Line, Rect, Text } from "react-konva";
import type { Task } from "../../../../../api/entities/tasks.ts";
import type { WhiteboardElement } from "../../../../../api/entities/whiteboards.ts";
import type { KonvaEventObject } from "./types.ts";

const RANK_LABELS = ["F", "C", "B", "A", "S"];

// Match TaskComplexity styling
const COMPLEXITY_STYLES: Record<
  number,
  { borderColor: string; bg: string; shadow: boolean }
> = {
  5: { borderColor: "#ffd700", bg: "#2a2a2a", shadow: true }, // S - gold
  4: { borderColor: "#c0c0c0", bg: "#2a2a2a", shadow: true }, // A - silver
  3: { borderColor: "#cd7f32", bg: "#2a2a2a", shadow: true }, // B - bronze
  2: { borderColor: "#495057", bg: "#2a2a2a", shadow: false }, // C
  1: { borderColor: "#495057", bg: "#1f1f1f", shadow: false }, // F
};

export interface WhiteboardTaskCardProps {
  element: WhiteboardElement;
  task: Task;
  isSelected: boolean;
  draggable: boolean;
  onClick: (e: KonvaEventObject<MouseEvent>) => void;
  onTap: () => void;
  onDblClick: () => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
}

const MAX_TITLE_LENGTH = 28;

const WhiteboardTaskCard = ({
  element,
  task,
  isSelected,
  draggable,
  onClick,
  onTap,
  onDblClick,
  onDragEnd,
}: WhiteboardTaskCardProps) => {
  const width = element.width ?? 220;
  const height = 48;
  const rank = RANK_LABELS[task.complexity - 1] ?? "F";
  const style = COMPLEXITY_STYLES[task.complexity] ?? COMPLEXITY_STYLES[1];
  const truncatedTitle =
    task.title.length > MAX_TITLE_LENGTH
      ? `${task.title.slice(0, MAX_TITLE_LENGTH)}...`
      : task.title;

  return (
    <Group
      id={element.id}
      x={element.x}
      y={element.y}
      rotation={element.rotation ?? 0}
      draggable={draggable}
      onClick={onClick}
      onTap={onTap}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragEnd={onDragEnd}
    >
      {/* Card background - theme aware */}
      <Rect
        width={width}
        height={height}
        fill="#25262b"
        stroke={isSelected ? "#228be6" : "#373a40"}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={8}
        shadowColor="rgba(0,0,0,0.2)"
        shadowBlur={isSelected ? 8 : 4}
        shadowOffset={{ x: 0, y: 2 }}
      />

      {/* Complexity badge - matches TaskComplexity */}
      <Rect
        x={8}
        y={8}
        width={24}
        height={24}
        fill={style.bg}
        stroke={style.borderColor}
        strokeWidth={1.5}
        cornerRadius={6}
        shadowColor={style.shadow ? "rgba(0,0,0,0.4)" : "transparent"}
        shadowBlur={style.shadow ? 4 : 0}
        shadowOffset={{ x: 0, y: 2 }}
      />
      <Text
        x={8}
        y={8}
        width={24}
        height={24}
        text={rank}
        fontSize={14}
        fontStyle="bold"
        fill="#e0e0e0"
        align="center"
        verticalAlign="middle"
      />

      {/* Task title */}
      <Text
        x={40}
        y={8}
        width={width - 56}
        height={16}
        text={truncatedTitle}
        fontSize={12}
        fontStyle="500"
        fill="#c9c9c9"
        wrap="none"
        ellipsis={true}
      />

      {/* Zone/Package label */}
      <Text
        x={40}
        y={26}
        width={width - 56}
        height={14}
        text={task.package}
        fontSize={10}
        fill="#868e96"
        wrap="none"
        ellipsis={true}
      />

      {/* Priority icon - High (!) */}
      {task.priority === "high" && (
        <>
          <Line
            points={[width - 16, 14, width - 16, 26]}
            stroke="#fa5252"
            strokeWidth={2.5}
            lineCap="round"
          />
          <Rect
            x={width - 18}
            y={30}
            width={4}
            height={4}
            fill="#fa5252"
            cornerRadius={2}
          />
        </>
      )}

      {/* Priority icon - Optional (sparkle) */}
      {task.priority === "optional" && (
        <Text x={width - 24} y={16} text="✦" fontSize={16} fill="#868e96" />
      )}
    </Group>
  );
};

export default WhiteboardTaskCard;
