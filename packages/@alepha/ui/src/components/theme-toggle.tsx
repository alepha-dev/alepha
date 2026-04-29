import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useColorMode } from "alepha/react/ui";
import { Moon, Sun } from "lucide-react";

export type ThemeToggleMode = "toggle" | "default";

export interface ThemeToggleProps {
  mode?: ThemeToggleMode;
}

export function ThemeToggle(props: ThemeToggleProps) {
  const mode = props.mode ?? "default";
  const { setMode, resolved, mode: current } = useColorMode();

  const icon = (
    <>
      <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </>
  );

  if (mode === "toggle") {
    const next = resolved === "dark" ? "light" : "dark";
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={() => setMode(next)}
      >
        {icon}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => setMode("light")}
          data-active={current === "light"}
        >
          Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setMode("dark")}
          data-active={current === "dark"}
        >
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setMode("system")}
          data-active={current === "system"}
        >
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
