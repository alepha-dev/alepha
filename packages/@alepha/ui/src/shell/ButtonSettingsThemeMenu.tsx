import * as React from "react";

void React;

import { useStore } from "alepha/react";
import { uiThemeListAtom, useTheme } from "alepha/react/ui";
import { Palette } from "lucide-react";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../core/DropdownMenu.tsx";
import { ButtonThemeSwatch } from "./ButtonThemeSwatch.tsx";

export interface ButtonSettingsThemeMenuProps {
  /**
   * Submenu label. Defaults to `"Theme"`.
   */
  label?: string;
}

/**
 * The theme picker as a submenu: the menu form of {@link ButtonTheme}, reading
 * the same `uiThemeListAtom` and writing the same `useTheme()` selection.
 *
 * Renders nothing when the list has 0 or 1 entries.
 */
export const ButtonSettingsThemeMenu = (
  props: ButtonSettingsThemeMenuProps,
) => {
  const { theme, setTheme } = useTheme();
  const [list] = useStore(uiThemeListAtom);
  const themes = list ?? [];

  if (themes.length <= 1) {
    return null;
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette className="size-4" />
        {props.label ?? "Theme"}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(id: string) => setTheme(id)}
        >
          {themes.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id} closeOnClick>
              {t.swatch && <ButtonThemeSwatch colors={t.swatch} />}
              {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};
