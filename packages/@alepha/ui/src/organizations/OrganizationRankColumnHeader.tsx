import { useI18n } from "alepha/react/i18n";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../core/DropdownMenu.tsx";

export interface OrganizationRankColumnHeaderProps {
  name: string;
  builtin: boolean;
  onRename?: () => void;
  onDelete?: () => void;
}

export const OrganizationRankColumnHeader = (
  props: OrganizationRankColumnHeaderProps,
) => {
  const { tr } = useI18n();
  const actionable = !!props.onRename || !!props.onDelete;

  return (
    <div className="flex items-center justify-center gap-1">
      {props.builtin && (
        <Badge variant="secondary" className="text-[10px]">
          {tr("organizations.ranks.builtin", { default: "Built-in" })}
        </Badge>
      )}
      <span className="font-medium">{props.name}</span>
      {actionable && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
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
