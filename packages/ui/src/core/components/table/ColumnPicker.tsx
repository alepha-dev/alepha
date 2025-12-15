import {
  Button,
  Checkbox,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { IconColumns } from "@tabler/icons-react";
import type { TObject } from "alepha";
import { useState } from "react";
import { ui } from "../../constants/ui.ts";
import ActionButton from "../buttons/ActionButton.tsx";
import type { ColumnVisibility, DataTableColumn } from "./types.ts";

export interface ColumnPickerProps<T extends object, Filters extends TObject> {
  columns: { [key: string]: DataTableColumn<T, Filters> };
  visibility: ColumnVisibility;
  onVisibilityChange: (visibility: ColumnVisibility) => void;
}

const ColumnPicker = <T extends object, Filters extends TObject>({
  columns,
  visibility,
  onVisibilityChange,
}: ColumnPickerProps<T, Filters>) => {
  const [opened, setOpened] = useState(false);
  const columnEntries = Object.entries(columns);

  const handleShowAll = () => {
    const newVisibility = columnEntries.reduce(
      (acc, [key]) => ({ ...acc, [key]: true }),
      {} as ColumnVisibility,
    );
    onVisibilityChange(newVisibility);
  };

  const handleHideAll = () => {
    const newVisibility = columnEntries.reduce(
      (acc, [key]) => ({ ...acc, [key]: false }),
      {} as ColumnVisibility,
    );
    onVisibilityChange(newVisibility);
  };

  const handleToggle = (key: string, checked: boolean) => {
    onVisibilityChange({
      ...visibility,
      [key]: checked,
    });
  };

  const visibleCount = columnEntries.filter(
    ([key]) => visibility[key] !== false,
  ).length;

  return (
    <Popover
      width={280}
      position="bottom-start"
      shadow="md"
      opened={opened}
      onChange={setOpened}
      closeOnClickOutside
      closeOnEscape
      transitionProps={{
        transition: "fade-up",
        duration: 200,
        timingFunction: "ease",
      }}
    >
      <Popover.Target>
        <ActionButton variant="subtle" icon={IconColumns} />
      </Popover.Target>
      <Popover.Dropdown
        bg="transparent"
        p="xs"
        bd={`1px solid ${ui.colors.border}`}
        style={{
          backdropFilter: "blur(20px)",
        }}
      >
        <Stack gap="xs" bg={ui.colors.surface} p="sm" bdrs="sm">
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              Columns ({visibleCount}/{columnEntries.length})
            </Text>
            <Group gap={4}>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={handleShowAll}
              >
                All
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={handleHideAll}
              >
                None
              </Button>
            </Group>
          </Group>

          <ScrollArea.Autosize mah={300}>
            <Stack gap={4}>
              {columnEntries.map(([key, col]) => (
                <Checkbox
                  key={key}
                  label={col.label}
                  checked={visibility[key] !== false}
                  onChange={(e) => handleToggle(key, e.currentTarget.checked)}
                  size="sm"
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

export default ColumnPicker;
