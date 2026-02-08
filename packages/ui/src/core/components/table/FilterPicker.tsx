import {
  Button,
  Checkbox,
  Flex,
  Popover,
  ScrollArea,
  Text,
} from "@mantine/core";
import { IconFilter } from "@tabler/icons-react";
import type { TObject } from "alepha";
import { useState } from "react";
import { ui } from "../../constants/ui.ts";
import ActionButton from "../buttons/ActionButton.tsx";
import type { FilterVisibility } from "./types.ts";

export interface FilterPickerProps {
  schema: TObject;
  visibility: FilterVisibility;
  onVisibilityChange: (visibility: FilterVisibility) => void;
}

const getFieldLabel = (schema: TObject, key: string): string => {
  const prop = schema.properties[key];
  if (prop && typeof prop === "object" && "title" in prop && prop.title) {
    return prop.title as string;
  }
  // Convert camelCase to Title Case
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
};

const FilterPicker = ({
  schema,
  visibility,
  onVisibilityChange,
}: FilterPickerProps) => {
  const [opened, setOpened] = useState(false);
  const filterKeys = Object.keys(schema.properties);

  const handleShowAll = () => {
    const newVisibility = filterKeys.reduce(
      (acc, key) => ({ ...acc, [key]: true }),
      {} as FilterVisibility,
    );
    onVisibilityChange(newVisibility);
  };

  const handleHideAll = () => {
    const newVisibility = filterKeys.reduce(
      (acc, key) => ({ ...acc, [key]: false }),
      {} as FilterVisibility,
    );
    onVisibilityChange(newVisibility);
  };

  const handleToggle = (key: string, checked: boolean) => {
    onVisibilityChange({
      ...visibility,
      [key]: checked,
    });
  };

  const visibleCount = filterKeys.filter(
    (key) => visibility[key] !== false,
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
        <ActionButton variant="subtle" icon={IconFilter} />
      </Popover.Target>
      <Popover.Dropdown
        bg="transparent"
        p="xs"
        bd={`1px solid ${ui.colors.border}`}
        style={{
          backdropFilter: "blur(20px)",
        }}
      >
        <Flex
          direction="column"
          gap="xs"
          bg={ui.colors.surface}
          p="sm"
          bdrs="sm"
        >
          <Flex justify="space-between">
            <Text size="sm" fw={500}>
              Filters ({visibleCount}/{filterKeys.length})
            </Text>
            <Flex gap={4}>
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
            </Flex>
          </Flex>

          <ScrollArea.Autosize mah={300}>
            <Flex direction="column" gap={4}>
              {filterKeys.map((key) => (
                <Checkbox
                  key={key}
                  label={getFieldLabel(schema, key)}
                  checked={visibility[key] !== false}
                  onChange={(e) => handleToggle(key, e.currentTarget.checked)}
                  size="sm"
                />
              ))}
            </Flex>
          </ScrollArea.Autosize>
        </Flex>
      </Popover.Dropdown>
    </Popover>
  );
};

export default FilterPicker;
