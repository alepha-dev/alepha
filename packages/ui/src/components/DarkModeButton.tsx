import {
  ActionIcon,
  Flex,
  SegmentedControl,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";

export interface DarkModeButtonProps {
  mode?: "minimal" | "segmented";
  size?: string | number;
  variant?:
    | "filled"
    | "light"
    | "outline"
    | "default"
    | "subtle"
    | "transparent";
}

const DarkModeButton = (props: DarkModeButtonProps) => {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const mode = props.mode ?? "minimal";

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

  if (mode === "segmented") {
    return (
      <SegmentedControl
        value={computedColorScheme}
        onChange={(value) => setColorScheme(value as "light" | "dark")}
        data={[
          {
            value: "light",
            label: (
              <Flex h={20} align="center" justify="center">
                <IconSun size={16} />
              </Flex>
            ),
          },
          {
            value: "dark",
            label: (
              <Flex h={20} align="center" justify="center">
                <IconMoon size={16} />
              </Flex>
            ),
          },
        ]}
      />
    );
  }

  return (
    <ActionIcon
      onClick={toggleColorScheme}
      variant={props.variant ?? "default"}
      size={props.size ?? "lg"}
      aria-label="Toggle color scheme"
    >
      {computedColorScheme === "dark" ? (
        <IconSun size={20} />
      ) : (
        <IconMoon size={20} />
      )}
    </ActionIcon>
  );
};

export default DarkModeButton;
