import { Text } from "@alepha/ui";
import { List, Modal } from "@mantine/core";

export interface HelpModalProps {
  opened: boolean;
  onClose: () => void;
}

const HelpModal = ({ opened, onClose }: HelpModalProps) => {
  return (
    <Modal opened={opened} onClose={onClose} title="Draw Help" size="md">
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
  );
};

export default HelpModal;
