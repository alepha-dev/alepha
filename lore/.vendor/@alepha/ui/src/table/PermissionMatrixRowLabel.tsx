import { Tooltip, TooltipContent, TooltipTrigger } from "../core/Tooltip.tsx";
import type { PermissionMatrixRow } from "./PermissionMatrix.tsx";

export interface PermissionMatrixRowLabelProps {
  permission: PermissionMatrixRow;
}

/**
 * A permission's label, carrying its `description` as a tooltip.
 *
 * A tooltip rather than a second line, because the mono permission name now
 * owns that line and a third one turns a dense table into a loose one.
 *
 * The trigger is Base UI's default (a button) with a dotted underline rather
 * than a bare `<span>`: a span is not focusable, so a description hung on one
 * is reachable with a mouse and by nothing else. The underline is what keeps
 * a focusable element from reading as an action - it is the abbreviation
 * affordance, "there is more to know here", not "this does something".
 *
 * Needs a `TooltipProvider` above it, like every other tooltip in this
 * package; `apps/ui` and `apps/lore` both mount one in their layout.
 */
export const PermissionMatrixRowLabel = (
  props: PermissionMatrixRowLabelProps,
) => {
  if (!props.permission.description) {
    return <span className="text-sm">{props.permission.label}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger className="decoration-muted-foreground/60 w-fit cursor-default text-left text-sm underline decoration-dotted underline-offset-4">
        {props.permission.label}
      </TooltipTrigger>
      <TooltipContent>{props.permission.description}</TooltipContent>
    </Tooltip>
  );
};
