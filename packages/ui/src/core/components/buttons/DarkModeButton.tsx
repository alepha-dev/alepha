import { useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { ui } from "../../constants/ui.ts";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

/**
 * SSR-safe dark mode toggle button.
 *
 * Uses CSS-based icon switching to avoid hydration mismatches.
 * Both icons are rendered, CSS hides the wrong one based on
 * `data-mantine-color-scheme` attribute.
 */
const DarkModeButton = (props: Partial<ActionProps>) => {
  const { setColorScheme } = useMantineColorScheme();

  const toggleColorScheme = () => {
    const current =
      document.documentElement.getAttribute("data-mantine-color-scheme") ??
      "light";
    setColorScheme(current === "dark" ? "light" : "dark");
  };

  const size = props.size ?? "sm";
  const iconSize =
    (ui.sizes.icon as Record<string, number>)[size] ?? ui.sizes.icon.sm;

  return (
    <ActionButton
      onClick={toggleColorScheme}
      variant={props.variant ?? "default"}
      size={size}
      aria-label="Toggle color scheme"
      icon={
        <>
          <IconSun size={iconSize} className="alepha-light-hidden" />
          <IconMoon size={iconSize} className="alepha-dark-hidden" />
        </>
      }
      {...props}
    />
  );
};

export default DarkModeButton;
