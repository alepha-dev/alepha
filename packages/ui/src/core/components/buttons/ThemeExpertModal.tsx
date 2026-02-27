import {
  ColorSwatch,
  Flex,
  Select,
  SimpleGrid,
  Text,
  useMantineTheme,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { AlephaThemeOverrides } from "../../atoms/alephaThemeOverridesAtom.ts";
import { useDialog } from "../../hooks/useDialog.ts";
import { useTheme } from "../../hooks/useTheme.ts";
import ActionButton from "./ActionButton.tsx";

const MANTINE_COLORS = [
  "red",
  "pink",
  "grape",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "yellow",
  "orange",
];

const RADIUS_OPTIONS = [
  { label: "xs", value: "xs" },
  { label: "sm", value: "sm" },
  { label: "md", value: "md" },
  { label: "lg", value: "lg" },
  { label: "xl", value: "xl" },
];

const SIZE_OPTIONS = [
  { label: "xs", value: "xs" },
  { label: "sm", value: "sm" },
  { label: "md", value: "md" },
  { label: "lg", value: "lg" },
  { label: "xl", value: "xl" },
];

const FONT_OPTIONS = [
  { label: "System", value: "" },
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Mono", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
];

const ThemeExpertModal = () => {
  const [, , expert] = useTheme();
  const dialog = useDialog();
  const mantineTheme = useMantineTheme();
  const { overrides, setOverrides } = expert;

  const currentColor = overrides.primaryColor || mantineTheme.primaryColor;
  const currentRadius = overrides.radius || mantineTheme.defaultRadius || "md";
  const currentFont = overrides.fontFamily || "";
  const currentFontSize = overrides.fontSize || "md";
  const currentScale = overrides.scale || "md";

  const updateOverrides = (patch: Partial<AlephaThemeOverrides>) => {
    setOverrides({ ...overrides, ...patch });
  };

  return (
    <Flex direction="column" gap="lg">
      <Flex direction="column" gap="xs">
        <Text fw={500} size="sm">
          Primary Color
        </Text>
        <SimpleGrid cols={6} spacing="xs">
          {MANTINE_COLORS.map((color) => (
            <Flex key={color} justify="center">
              <ColorSwatch
                color={mantineTheme.colors[color]?.[6] ?? color}
                onClick={() => updateOverrides({ primaryColor: color })}
                style={{ cursor: "pointer" }}
                size={32}
              >
                {currentColor === color && (
                  <IconCheck size={14} color="white" />
                )}
              </ColorSwatch>
            </Flex>
          ))}
        </SimpleGrid>
      </Flex>

      <Flex direction="column" gap="xs">
        <Text fw={500} size="sm">
          Border Radius
        </Text>
        <Flex gap="xs">
          {RADIUS_OPTIONS.map((opt) => (
            <ActionButton
              key={opt.value}
              variant={
                String(currentRadius) === opt.value ? "filled" : "default"
              }
              size="xs"
              flex={1}
              onClick={() => updateOverrides({ radius: opt.value })}
            >
              {opt.label}
            </ActionButton>
          ))}
        </Flex>
      </Flex>

      <Flex direction="column" gap="xs">
        <Text fw={500} size="sm">
          Font Family
        </Text>
        <Select
          data={FONT_OPTIONS}
          value={currentFont}
          onChange={(value) => updateOverrides({ fontFamily: value ?? "" })}
          allowDeselect={false}
        />
      </Flex>

      <Flex direction="column" gap="xs">
        <Text fw={500} size="sm">
          Font Size
        </Text>
        <Flex gap="xs">
          {SIZE_OPTIONS.map((opt) => (
            <ActionButton
              key={opt.value}
              variant={currentFontSize === opt.value ? "filled" : "default"}
              size="xs"
              flex={1}
              onClick={() => updateOverrides({ fontSize: opt.value })}
            >
              {opt.label}
            </ActionButton>
          ))}
        </Flex>
      </Flex>

      <Flex direction="column" gap="xs">
        <Text fw={500} size="sm">
          Scale
        </Text>
        <Flex gap="xs">
          {SIZE_OPTIONS.map((opt) => (
            <ActionButton
              key={opt.value}
              variant={currentScale === opt.value ? "filled" : "default"}
              size="xs"
              flex={1}
              onClick={() => updateOverrides({ scale: opt.value })}
            >
              {opt.label}
            </ActionButton>
          ))}
        </Flex>
      </Flex>

      <Flex justify="space-between">
        <ActionButton
          variant="subtle"
          color="red"
          onClick={() => expert.resetOverrides()}
        >
          Reset
        </ActionButton>
        <ActionButton
          variant={"default"}
          px={"xl"}
          onClick={() => dialog.close()}
        >
          OK
        </ActionButton>
      </Flex>
    </Flex>
  );
};

export default ThemeExpertModal;
