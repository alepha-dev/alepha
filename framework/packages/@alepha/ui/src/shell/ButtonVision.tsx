import * as React from "react";

void React;

import { useVisionMode } from "alepha/react/ui";
import { Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../core/Button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";

export interface ButtonVisionProps {
  /**
   * Optional aria-label override. Defaults to `"Colour-blind mode"`.
   */
  label?: string;
  /**
   * Visual variant. Defaults to `"minimal"`. Pass `"outlined"` for a
   * bordered toolbar look.
   */
  variant?: "minimal" | "outlined";
}

/**
 * Both icons, always rendered, with the `cvd` class on `<html>` revealing
 * one: the vision mode is a paint, not a render, for the reason
 * `ButtonDark` gives. A prerendered page carries the default icon, and the
 * boot script has already set the class from the cookie by first paint, so
 * the visitor sees their own state with no hydration mismatch.
 */
const ICONS: ReactNode = (
  <>
    <Eye className="size-4 [.cvd_&]:hidden" />
    <EyeOff className="hidden size-4 [.cvd_&]:block" />
  </>
);

/**
 * Colour-blind mode toggle: flips the vision mode between `normal` and `cvd`
 * through `useVisionMode()`, persisted in the UI cookie beside the color mode
 * and the theme, and independent of both.
 *
 * `cvd` puts the class `cvd` on `<html>`, under which the kit's stylesheet
 * swaps its signal colours (success, warning, danger, the chart palette) for
 * a colour-blind-safe palette. An app remaps its own signal tokens in a
 * `.cvd` block (and `.cvd.dark` for dark mode).
 *
 * `aria-pressed` reports the state to assistive technology. It reads the
 * default until hydration has committed, like every UI preference (see
 * `useUiState`), and the visitor's value right after.
 */
export const ButtonVision = (props: ButtonVisionProps) => {
  const { vision, toggle } = useVisionMode();
  const label = props.label ?? "Colour-blind mode";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={props.variant ?? "minimal"}
            size="icon"
            aria-label={label}
            aria-pressed={vision === "cvd"}
            onClick={toggle}
          />
        }
      >
        {ICONS}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
