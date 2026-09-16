import * as React from "react";

void React;

import { useStore } from "alepha/react";
import { uiThemeListAtom, useTheme } from "alepha/react/ui";
import { Check, Palette } from "lucide-react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";
import { cn } from "../core/utils.ts";
import { ButtonThemeSwatch } from "./ButtonThemeSwatch.tsx";

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
          {/*
            `DropdownMenuItem`, not a raw `<button>`. These were plain buttons
            inside a `role="menu"`, which cost two things that are the menu
            primitive's whole job: the container announced itself as a menu
            with NO items to assistive technology, and picking a theme left the
            menu open - alone among every dropdown in the app - because only an
            Item tells the root to close on select.
          */}
          {themes.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                "flex w-full items-center gap-2.5 px-2 py-1.5 text-sm",
                theme === t.id && "bg-accent",
              )}
            >
              {t.swatch && <ButtonThemeSwatch colors={t.swatch} />}
              <span className="flex-1 text-left">{t.label}</span>
              {theme === t.id && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
