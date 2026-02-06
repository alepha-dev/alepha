import { useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
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

  return (
    <ActionButton
      onClick={toggleColorScheme}
      variant={props.variant ?? "subtle"}
      size={props.size ?? "sm"}
      aria-label="Toggle color scheme"
      px={"xs"}
      icon={
        <>
          <IconSun size={14} className="alepha-light-hidden" />
          <IconMoon size={14} className="alepha-dark-hidden" />
        </>
      }
      {...props}
    />
  );
};

export default DarkModeButton;
