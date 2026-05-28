import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useColorMode } from "alepha/react/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

export interface ButtonDarkProps {
  /**
   * Optional aria-label override. Defaults to `"Toggle color mode"`.
   */
  label?: string;
  /**
   * When `true`, the button cycles through three states `light → dark →
   * system`. By default the button toggles strictly between `light` and
   * `dark` using the resolved mode as the starting point.
   */
  withSystem?: boolean;
  /**
   * Visual variant. Defaults to `"ghost"` (minimal). Pass `"outline"` for a
   * bordered toolbar look.
   */
  variant?: "ghost" | "outline";
}

const ICON: Record<"light" | "dark" | "system", ReactNode> = {
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
 * Color-mode toggle. Default is a two-state Sun ↔ Moon flip; opt into the
 * three-state `light → dark → system` cycle with `withSystem`.
 * Reads/writes the persisted UI cookie via `useColorMode()`.
 */
export function ButtonDark(props: ButtonDarkProps) {
  const { mode, resolved, setMode } = useColorMode();
  const onClick = () => {
    if (props.withSystem) {
      setMode(NEXT[mode]);
    } else {
      setMode(resolved === "dark" ? "light" : "dark");
    }
  };
  const iconKey = props.withSystem ? mode : resolved;
  const label = props.label ?? "Toggle color mode";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={props.variant ?? "ghost"}
            size="icon"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {ICON[iconKey]}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
