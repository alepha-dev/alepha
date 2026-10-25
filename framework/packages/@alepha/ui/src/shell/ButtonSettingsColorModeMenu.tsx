import * as React from "react";

void React;

import { type ColorMode, useColorMode } from "alepha/react/ui";
import { Monitor, Moon, Sun, SunMoon } from "lucide-react";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../core/DropdownMenu.tsx";

export interface ButtonSettingsColorModeMenuProps {
  /**
   * Submenu label. Defaults to `"Display Mode"`.
   */
  label?: string;
  /**
   * Option labels. Default to `"System"`, `"Dark"` and `"Light"`.
   */
  labels?: {
    system?: string;
    dark?: string;
    light?: string;
  };
}

/**
 * The color-mode picker as a submenu: `system`, `dark` and `light` as a
 * single choice, through `useColorMode()`.
 *
 * Unlike {@link ButtonDark}, it offers `system` always: a menu has room for
 * the third option that a one-click toggle has to cycle through.
 *
 * Reading the mode during render is safe here, where it is not in
 * `ButtonDark`: the submenu mounts only when opened, so the server never
 * renders it and there is nothing to hydrate.
 */
export const ButtonSettingsColorModeMenu = (
  props: ButtonSettingsColorModeMenuProps,
) => {
  const { mode, setMode } = useColorMode();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <SunMoon className="size-4" />
        {props.label ?? "Display Mode"}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(next: ColorMode) => setMode(next)}
        >
          <DropdownMenuRadioItem value="system" closeOnClick>
            <Monitor className="size-4" />
            {props.labels?.system ?? "System"}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" closeOnClick>
            <Moon className="size-4" />
            {props.labels?.dark ?? "Dark"}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" closeOnClick>
            <Sun className="size-4" />
            {props.labels?.light ?? "Light"}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};
