import { ActionIcon, ColorInput, Divider, Group, Tooltip } from "@mantine/core";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowNarrowRight,
  IconCircle,
  IconEraser,
  IconPencil,
  IconPhoto,
  IconPointer,
  IconSquare,
  IconTypography,
} from "@tabler/icons-react";

export type ToolType =
  | "select"
  | "rect"
  | "circle"
  | "arrow"
  | "text"
  | "line"
  | "image"
  | "eraser";

export interface WhiteboardToolbarProps {
  tool: ToolType;
  onToolChange: (tool: ToolType) => void;
  strokeColor: string;
  onStrokeColorChange: (color: string) => void;
  fillColor: string;
  onFillColorChange: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onImageUpload: () => void;
  isUploadingImage?: boolean;
}

const tools: Array<{
  id: ToolType;
  icon: React.ReactNode;
  label: string;
}> = [
  { id: "select", icon: <IconPointer size={18} />, label: "Select (Esc)" },
  { id: "rect", icon: <IconSquare size={18} />, label: "Rectangle" },
  { id: "circle", icon: <IconCircle size={18} />, label: "Circle" },
  { id: "arrow", icon: <IconArrowNarrowRight size={18} />, label: "Arrow" },
  { id: "text", icon: <IconTypography size={18} />, label: "Text" },
  { id: "image", icon: <IconPhoto size={18} />, label: "Image" },
  { id: "line", icon: <IconPencil size={18} />, label: "Draw" },
  { id: "eraser", icon: <IconEraser size={18} />, label: "Eraser" },
];

const WhiteboardToolbar = ({
  tool,
  onToolChange,
  strokeColor,
  onStrokeColorChange,
  fillColor,
  onFillColorChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onImageUpload,
  isUploadingImage,
}: WhiteboardToolbarProps) => {
  return (
    <Group gap="xs">
      {tools.map((t) => (
        <Tooltip key={t.id} label={t.label} position="bottom">
          <ActionIcon
            variant={tool === t.id ? "filled" : "subtle"}
            color={tool === t.id ? "blue" : "gray"}
            onClick={() => {
              if (t.id === "image") {
                onImageUpload();
              } else {
                onToolChange(t.id);
              }
            }}
            size="md"
            loading={t.id === "image" && isUploadingImage}
          >
            {t.icon}
          </ActionIcon>
        </Tooltip>
      ))}

      <Divider orientation="vertical" />

      <Tooltip label="Stroke color" position="bottom">
        <ColorInput
          size="xs"
          w={100}
          value={strokeColor}
          onChange={onStrokeColorChange}
          format="hex"
          swatches={[
            "#000000",
            "#ffffff",
            "#fa5252",
            "#e64980",
            "#be4bdb",
            "#7950f2",
            "#4c6ef5",
            "#228be6",
            "#15aabf",
            "#12b886",
            "#40c057",
            "#82c91e",
            "#fab005",
            "#fd7e14",
          ]}
        />
      </Tooltip>

      <Tooltip label="Fill color" position="bottom">
        <ColorInput
          size="xs"
          w={100}
          value={fillColor}
          onChange={onFillColorChange}
          format="hex"
          swatches={[
            "#ffffff",
            "#000000",
            "#ffe3e3",
            "#fcc2d7",
            "#eebefa",
            "#d0bfff",
            "#bac8ff",
            "#a5d8ff",
            "#c5f6fa",
            "#c3fae8",
            "#d3f9d8",
            "#e9fac8",
            "#fff3bf",
            "#ffe8cc",
          ]}
        />
      </Tooltip>

      <Divider orientation="vertical" />

      <Tooltip label="Undo (Ctrl+Z)" position="bottom">
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={onUndo}
          disabled={!canUndo}
          size="md"
        >
          <IconArrowBackUp size={18} />
        </ActionIcon>
      </Tooltip>

      <Tooltip label="Redo (Ctrl+Shift+Z)" position="bottom">
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={onRedo}
          disabled={!canRedo}
          size="md"
        >
          <IconArrowForwardUp size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
};

export default WhiteboardToolbar;
