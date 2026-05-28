import * as React from "react";

void React;

import { Card } from "@alepha/ui/components/ui/card";
import { cn } from "@alepha/ui/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface CollapsibleCardProps {
  /**
   * Optional leading icon node, rendered at the start of the header row.
   */
  icon?: ReactNode;
  /**
   * Header content, rendered between the icon and the actions/caret.
   */
  header: ReactNode;
  /**
   * Optional actions node, rendered immediately left of the caret. Kept
   * separate from the caret so an embedded trigger (e.g. a dropdown) does not
   * toggle the card when clicked.
   */
  actions?: ReactNode;
  /**
   * Initial expanded state in uncontrolled mode. Defaults to `false`.
   */
  defaultOpen?: boolean;
  /**
   * Controlled expanded state. When provided, the card does not manage its own
   * open state and relies on `onOpenChange`.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

/**
 * A card whose body can be collapsed behind a caret in the header.
 *
 * Header layout: `[icon] [header ............] [actions] [caret]`. The caret is
 * the sole toggle; the actions slot is independent so embedded controls do not
 * expand/collapse the card.
 *
 * Dependency-free: uses `useState` + a chevron toggle (the same pattern as
 * `control-object`), no Radix collapsible.
 */
export const CollapsibleCard = (props: CollapsibleCardProps) => {
  const [internalOpen, setInternalOpen] = useState(props.defaultOpen ?? false);
  const isControlled = props.open !== undefined;
  const open = isControlled ? !!props.open : internalOpen;

  const toggle = () => {
    const next = !open;
    if (!isControlled) {
      setInternalOpen(next);
    }
    props.onOpenChange?.(next);
  };

  return (
    // py-0/gap-0 are intentional: this card lays out its own header/body rows
    // and does not use CardContent, so the usual "don't override Card padding"
    // caveat (double padding with CardContent) does not apply here.
    <Card size="sm" className={cn("gap-0 py-0", props.className)}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {props.icon != null && (
          <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
            {props.icon}
          </span>
        )}
        <div className="min-w-0 flex-1">{props.header}</div>
        {props.actions != null && (
          <div className="flex shrink-0 items-center">{props.actions}</div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          className="hover:bg-accent text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
        >
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
      </div>
      {open && <div className="border-t px-3 py-2.5">{props.children}</div>}
    </Card>
  );
};
