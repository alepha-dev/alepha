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

const NEXT: Record<"light" | "dark" | "system", "light" | "dark" | "system"> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/**
 * Every icon the button can show, all rendered, with CSS revealing one.
 *
 * ⚠️ This is the point of the component, not a styling flourish. It used to
 * render ONE icon chosen from the color mode DURING RENDER, which is a
 * hydration mismatch on any PRERENDERED page: the HTML is built with the
 * default preference and the client renders the visitor's. React reported #418
 * on every cold load for anyone who had ever picked a mode, then threw the
 * prerendered tree away and re-rendered from scratch - most of what
 * prerendering was buying.
 *
 * `apps/docs` had already solved this by hand and wrote the rule down: the
 * theme is "a paint, not a render". The markup here is identical for every
 * visitor, and `.dark` / `data-color-mode` on `<html>` - both outside React's
 * tree, both set by `ColorScheme` - decide which copy shows.
 *
 * A mount gate would be the other way round, and it is wrong here: an app that
 * genuinely SSRs (Lore) already emits the right icon from the request's
 * cookie, so deferring to a mount would INTRODUCE the mismatch it is meant to
 * prevent. `withSystem` is a prop, identical on both sides, so branching on it
 * is safe.
 */
const TWO_STATE_ICONS: ReactNode = (
  <>
    <Sun className="size-4 dark:hidden" />
    <Moon className="hidden size-4 dark:block" />
  </>
);

/**
 * The three-state cycle needs the UNRESOLVED preference, which `.dark` cannot
 * express: "system, resolved to dark" and "dark, chosen" carry the same class.
 * `data-color-mode` carries it.
 *
 * The system icon is the one that shows when the attribute is ABSENT, which is
 * every first paint and every prerendered document - and `system` is also the
 * default mode, so the fallback is the correct answer rather than a guess.
 */
const THREE_STATE_ICONS: ReactNode = (
  <>
    <Sun className="hidden size-4 [[data-color-mode='light']_&]:block" />
    <Moon className="hidden size-4 [[data-color-mode='dark']_&]:block" />
    <Monitor className="size-4 [[data-color-mode='dark']_&]:hidden [[data-color-mode='light']_&]:hidden" />
  </>
);

/**
 * Color-mode toggle. Default is a two-state Sun ↔ Moon flip; opt into the
 * three-state `light → dark → system` cycle with `withSystem`.
 * Reads/writes the persisted UI cookie via `useColorMode()`.
 */
export const ButtonDark = (props: ButtonDarkProps) => {
  const { mode, resolved, setMode } = useColorMode();
  const onClick = () => {
    if (props.withSystem) {
      setMode(NEXT[mode]);
    } else {
      setMode(resolved === "dark" ? "light" : "dark");
    }
  };
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
        {props.withSystem ? THREE_STATE_ICONS : TWO_STATE_ICONS}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
