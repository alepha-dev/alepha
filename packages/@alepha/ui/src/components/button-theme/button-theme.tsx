import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { cn } from "@alepha/ui/lib/utils";
import { useStore } from "alepha/react";
import { uiThemeListAtom, useTheme } from "alepha/react/ui";
import { Check, Palette } from "lucide-react";

export interface ButtonThemeProps {
  /**
   * Optional aria-label override. Defaults to `"Pick theme"`.
   */
  label?: string;
  /**
   * Optional dropdown header. Defaults to `"Themes"`.
   */
  heading?: string;
  /**
   * Visual variant. Defaults to `"ghost"` (minimal). Pass `"outline"` for a
   * bordered toolbar look.
   */
  variant?: "ghost" | "outline";
}

/**
 * Theme picker reading the available list from `uiThemeListAtom` and the
 * selected id from `useTheme()`. Apps register their themes once at boot:
 *
 * ```ts
 * alepha.store.set(uiThemeListAtom, [
 *   { id: "default", label: "Default" },
 *   { id: "claude",  label: "Claude", swatch: [...], fontHref: "https://..." },
 * ]);
 * ```
 *
 * Renders nothing when the list has 0 or 1 entries. Loading a theme's
 * `fontHref` is `<ColorScheme/>`'s job, not this one's: a picker is absent
 * from most pages, so an injection done here reached only the pages that
 * happen to show a toolbar.
 */
export const ButtonTheme = (props: ButtonThemeProps) => {
  const { theme, setTheme } = useTheme();
  const [list] = useStore(uiThemeListAtom);
  const themes = list ?? [];

  if (themes.length <= 1) {
    return null;
  }

  const label = props.label ?? "Pick theme";
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant={props.variant ?? "ghost"}
                  size="icon"
                  aria-label={label}
                />
              }
            />
          }
        >
          <Palette className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{props.heading ?? "Themes"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={cn(
                "hover:bg-accent flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm",
                theme === t.id && "bg-accent",
              )}
            >
              {t.swatch && <ThemeSwatch colors={t.swatch} />}
              <span className="flex-1 text-left">{t.label}</span>
              {theme === t.id && <Check className="size-3.5" />}
            </button>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface ThemeSwatchProps {
  colors: string[];
}

const ThemeSwatch = (props: ThemeSwatchProps) => {
  return (
    <div className="border-border grid size-6 shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-sm border bg-white p-px">
      {props.colors.slice(0, 4).map((c, i) => (
        <span
          key={i}
          className="block rounded-[1px]"
          style={{ background: c }}
        />
      ))}
    </div>
  );
};
