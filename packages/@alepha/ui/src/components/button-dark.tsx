import { Button } from "@alepha/ui/components/ui/button";
import { useColorMode } from "alepha/react/ui";
import { Monitor, Moon, Sun } from "lucide-react";

export interface ButtonDarkProps {
  /**
   * Optional aria-label override. Defaults to `"Toggle color mode"`.
   */
  label?: string;
}

const ICON: Record<"light" | "dark" | "system", React.ReactNode> = {
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
  system: <Monitor className="size-4" />,
};

const NEXT: Record<"light" | "dark" | "system", "light" | "dark" | "system"> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/**
 * Three-state color-mode toggle: cycles `light → dark → system` on click.
 * Reads/writes the persisted UI cookie via `useColorMode()`.
 */
export function ButtonDark(props: ButtonDarkProps) {
  const { mode, setMode } = useColorMode();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={props.label ?? "Toggle color mode"}
      onClick={() => setMode(NEXT[mode])}
    >
      {ICON[mode]}
    </Button>
  );
}
