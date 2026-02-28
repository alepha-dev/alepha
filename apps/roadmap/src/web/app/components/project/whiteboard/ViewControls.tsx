import { ActionButton, Flex, Text } from "@alepha/ui";
import { Divider, Paper, Tooltip } from "@mantine/core";
import {
  IconFocusCentered,
  IconHandStop,
  IconHome,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import classes from "./WhiteboardCanvas.module.css";

export interface ViewControlsProps {
  zoom: number;
  spacePressed: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitToContent: () => void;
  onSetZoom: (zoom: number) => void;
}

const ViewControls = (props: ViewControlsProps) => {
  const {
    zoom,
    spacePressed,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onFitToContent,
    onSetZoom,
  } = props;
  return (
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
          <ActionButton
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onZoomReset}
          >
            <IconHome size={14} />
          </ActionButton>
        </Tooltip>
        <Tooltip label="Fit to content">
          <ActionButton
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onFitToContent}
          >
            <IconFocusCentered size={14} />
          </ActionButton>
        </Tooltip>
        <Divider orientation="vertical" />
        <Tooltip label="Zoom out (Ctrl+-)">
          <ActionButton
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onZoomOut}
            disabled={zoom <= 0.1}
          >
            <IconMinus size={14} />
          </ActionButton>
        </Tooltip>
        <Tooltip label="Click to reset zoom">
          <Flex
            style={{ cursor: "pointer", minWidth: 40, textAlign: "center" }}
            onClick={() => onSetZoom(1)}
            justify="center"
          >
            <Text size="xs" fw={500}>
              {Math.round(zoom * 100)}%
            </Text>
          </Flex>
        </Tooltip>
        <Tooltip label="Zoom in (Ctrl++)">
          <ActionButton
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onZoomIn}
            disabled={zoom >= 3}
          >
            <IconPlus size={14} />
          </ActionButton>
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
  );
};

export default ViewControls;
