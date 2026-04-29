import { ActionButton, Flex } from "@alepha/mantine";
import { ColorInput, Divider, Tooltip } from "@mantine/core";
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
import type { ToolType } from "./types.ts";

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

const WhiteboardToolbar = (props: WhiteboardToolbarProps) => {
  const {
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
  } = props;
  return (
    <Flex gap="xs" align={"center"}>
      {tools.map((t) => (
        <Tooltip key={t.id} label={t.label} position="bottom">
          <ActionButton
            variant={tool === t.id ? "filled" : "default"}
            color={tool === t.id ? "blue" : "gray"}
            onClick={() => {
              if (t.id === "image") {
                onImageUpload();
              } else {
                onToolChange(t.id);
              }
            }}
            loading={t.id === "image" && isUploadingImage}
          >
            {t.icon}
          </ActionButton>
        </Tooltip>
      ))}

      <Divider orientation="vertical" />

      <Tooltip label="Stroke color" position="bottom">
        <ColorInput
          size="sm"
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
          size="sm"
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
        <ActionButton
          variant="default"
          color="gray"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <IconArrowBackUp size={18} />
        </ActionButton>
      </Tooltip>

      <Tooltip label="Redo (Ctrl+Shift+Z)" position="bottom">
        <ActionButton
          variant="default"
          color="gray"
          onClick={onRedo}
          disabled={!canRedo}
        >
          <IconArrowForwardUp size={18} />
        </ActionButton>
      </Tooltip>
    </Flex>
  );
};

export default WhiteboardToolbar;
