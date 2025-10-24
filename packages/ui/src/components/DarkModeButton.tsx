import {
  ActionIcon,
  Flex,
  SegmentedControl,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useEffect, useState } from "react";

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
  const [colorScheme, setColorScheme2] = useState("default");
  const mode = props.mode ?? "minimal";

  useEffect(() => {
    setColorScheme2(computedColorScheme);
  }, [computedColorScheme]);

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === "dark" ? "light" : "dark");
  };

  if (mode === "segmented") {
    return (
      <SegmentedControl
        value={colorScheme}
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
      {colorScheme === "dark" ? (
        <IconSun size={20} />
      ) : colorScheme === "light" ? (
        <IconMoon size={20} />
      ) : (
        <Flex h={20} />
      )}
    </ActionIcon>
  );
};

export default DarkModeButton;
