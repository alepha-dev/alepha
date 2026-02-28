import { Flex, Text } from "@alepha/ui";
import { Paper } from "@mantine/core";
import { useI18n } from "alepha/react/i18n";
import type { WhiteboardElement } from "@/api/entities/whiteboards.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { Position, Size } from "./types.ts";
import classes from "./WhiteboardCanvas.module.css";

export interface CanvasMinimapProps {
  elements: WhiteboardElement[];
  stagePos: Position;
  stageSize: Size;
  zoom: number;
}

const CanvasMinimap = (props: CanvasMinimapProps) => {
  const { elements, stagePos, stageSize, zoom } = props;
  const { tr } = useI18n<I18n, "en">();

  if (elements.length === 0) {
    return (
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
        <Flex h="100%" align="center" justify="center">
          <Text size="xs" c="dimmed">
            {tr("whiteboard.emptyCanvas")}
          </Text>
        </Flex>
      </Paper>
    );
  }

  // Calculate bounds of all elements
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
  const scale = Math.min(mapWidth / contentWidth, mapHeight / contentHeight, 1);

  // Calculate viewport rectangle
  const viewX = (-stagePos.x / zoom - minX) * scale;
  const viewY = (-stagePos.y / zoom - minY) * scale;
  const viewW = (stageSize.width / zoom) * scale;
  const viewH = (stageSize.height / zoom) * scale;

  return (
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
      <Flex style={{ position: "relative", width: "100%", height: "100%" }}>
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
            <Flex
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
        <Flex
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
      </Flex>
    </Paper>
  );
};

export default CanvasMinimap;
