import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useI18n } from "alepha/react/i18n";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectRankColumnHeaderProps {
  name: string;

  /**
   * Declared in code and therefore not removable. Shown as a chip so the
   * absent Delete entry reads as a rule rather than as a missing feature.
   */
  builtin: boolean;

  /**
   * Absent when this rank refuses rewrites - the owner column. Both entries
   * disappear with it, since renaming is a rewrite.
   */
  onRename?: () => void;

  onDelete?: () => void;
}

/**
 * A rank, as the matrix's column header renders it.
 *
 * The shared component takes a `ReactNode` for a column label precisely so
 * this can live here: what a rank IS - built-in, renamable - is Lore's model,
 * and `@alepha/ui` renders whatever it is handed.
 *
 * The holder count is NOT here. It goes in the column's `description`, which
 * the matrix prints on one line with the coverage ratio it computes itself
 * ("4 membres - 8/11") above the bar. Rendered here it would sit above that
 * line and say the same kind of thing twice, in two places, at two sizes.
 */
const ProjectRankColumnHeader = (props: ProjectRankColumnHeaderProps) => {
  const { tr } = useI18n<I18n, "en">();
  const actionable = !!props.onRename || !!props.onDelete;

  return (
    <div className="flex items-center justify-center gap-1">
      {props.builtin && (
        <Badge variant="secondary" className="text-[10px]">
          {tr("project.settings.ranks.builtin")}
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
                aria-label={String(
                  tr("project.settings.ranks.actions", {
                    args: [props.name],
                  }),
                )}
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {props.onRename && (
              <DropdownMenuItem onClick={props.onRename}>
                <Pencil className="size-4" />
                {tr("project.settings.ranks.rename")}
              </DropdownMenuItem>
            )}
            {props.onDelete && (
              <DropdownMenuItem onClick={props.onDelete} variant="destructive">
                <Trash2 className="size-4" />
                {tr("project.settings.ranks.delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

export default ProjectRankColumnHeader;
