import {
  Flex,
  type MantineBreakpoint,
  SegmentedControl,
  type SegmentedControlProps,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

export interface DarkModeButtonProps {
  mode?: "minimal" | "segmented";
  size?: MantineBreakpoint;
  variant?:
    | "filled"
    | "light"
    | "outline"
    | "default"
    | "subtle"
    | "transparent";

  fullWidth?: boolean;

  segmentedProps?: Partial<SegmentedControlProps>;
  actionProps?: Partial<ActionProps>;
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
        w={props.fullWidth ? "100%" : undefined}
        {...props.segmentedProps}
      />
    );
  }

  return (
    <ActionButton
      onClick={toggleColorScheme}
      variant={props.variant ?? "subtle"}
      size={props.size ?? "sm"}
      aria-label="Toggle color scheme"
      px={"xs"}
      c={colorScheme !== "default" ? undefined : "transparent"}
      fullWidth={props.fullWidth ?? false}
      icon={
        colorScheme === "dark"
          ? IconSun
          : colorScheme === "light"
            ? IconMoon
            : IconSun
      }
      {...props.actionProps}
    />
  );
};

export default DarkModeButton;
