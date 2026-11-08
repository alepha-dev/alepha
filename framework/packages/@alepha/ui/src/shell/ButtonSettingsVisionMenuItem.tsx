import * as React from "react";

void React;

import { useVisionMode } from "alepha/react/ui";
import { Eye } from "lucide-react";

import { DropdownMenuCheckboxItem } from "../core/DropdownMenu.tsx";

export interface ButtonSettingsVisionMenuItemProps {
  /**
   * Item label. Defaults to `"Colour-blind mode"`.
   */
  label?: string;
}

/**
 * The vision mode as a checkbox item of the account menu: checked while the
 * colour-blind palette is on, through `useVisionMode()`.
 *
 * Reading the mode during render is safe here, as in the color-mode submenu:
 * the menu mounts only when opened, so the server never renders it.
 */
export const ButtonSettingsVisionMenuItem = (
  props: ButtonSettingsVisionMenuItemProps,
) => {
  const { vision, setVision } = useVisionMode();

  return (
    <DropdownMenuCheckboxItem
      checked={vision === "cvd"}
      onCheckedChange={(checked: boolean) =>
        setVision(checked ? "cvd" : "normal")
      }
    >
      <Eye className="size-4" />
      {props.label ?? "Colour-blind mode"}
    </DropdownMenuCheckboxItem>
  );
};
