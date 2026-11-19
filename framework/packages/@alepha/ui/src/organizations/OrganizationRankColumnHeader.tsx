import { useI18n } from "alepha/react/i18n";
import {
  CircleDot,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../core/Tooltip.tsx";

export interface OrganizationRankColumnHeaderProps {
  name: string;
  onRename?: () => void;
  onDelete?: () => void;
  /**
   * How many permissions differ from the rank's default. Above zero, a small
   * mark beside the name says so on hover.
   */
  differences?: number;
  /**
   * Puts the rank back on its default. Offered only when it differs.
   */
  onReset?: () => void;
}

export const OrganizationRankColumnHeader = (
  props: OrganizationRankColumnHeaderProps,
) => {
  const { tr } = useI18n();
  const differences = props.differences ?? 0;
  const resettable = differences > 0 && !!props.onReset;
  const actionable = !!props.onRename || !!props.onDelete || resettable;
  const differ =
    differences === 1
      ? tr("organizations.ranks.differ", {
          default: "1 permission differs from the default",
        })
      : tr("organizations.ranks.differs", {
          default: "$1 permissions differ from the default",
          args: [String(differences)],
        });

  return (
    <div className="flex items-center justify-center gap-1">
      <span className="font-medium">{props.name}</span>
      {differences > 0 && (
        // A small mark rather than a label: the column only has to be told
        // apart, and the tooltip says why. Named as an image, so a screen
        // reader hears the same words.
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  role="img"
                  aria-label={differ}
                  data-testid="rank-differs"
                  className="text-warning-text inline-flex shrink-0"
                />
              }
            >
              <CircleDot className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{differ}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {actionable && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="minimal"
                size="icon"
                className="size-6"
                aria-label={tr("organizations.ranks.actions", {
                  default: "$1 actions",
                  args: [props.name],
                })}
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {props.onRename && (
              <DropdownMenuItem onClick={props.onRename}>
                <Pencil className="size-4" />
                {tr("organizations.ranks.rename", { default: "Rename" })}
              </DropdownMenuItem>
            )}
            {resettable && (
              <DropdownMenuItem onClick={props.onReset}>
                <RotateCcw className="size-4" />
                {tr("organizations.ranks.reset", {
                  default: "Reset to default",
                })}
              </DropdownMenuItem>
            )}
            {props.onDelete && (
              <DropdownMenuItem onClick={props.onDelete} variant="destructive">
                <Trash2 className="size-4" />
                {tr("organizations.ranks.delete", { default: "Delete" })}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
