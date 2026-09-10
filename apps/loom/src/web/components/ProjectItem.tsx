import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { useClient } from "alepha/react";
import { Link, useRouter } from "alepha/react/router";
import { FolderGit2, X } from "lucide-react";

import type { LoomController } from "../../api/controllers/LoomController.ts";
import type { Project } from "../../api/schemas/projectSchema.ts";
import type { AppRouter } from "../AppRouter.ts";

export interface ProjectItemProps {
  project: Project;
  selected: boolean;
}

/**
 * One project in the side bar: a link to it, and a remove button on hover.
 * Removing only stops Loom watching; nothing on disk changes, and the
 * confirmation says so.
 */
export const ProjectItem = (props: ProjectItemProps) => {
  const api = useClient<LoomController>();
  const router = useRouter<AppRouter>();
  const dialog = useDialog();
  const toast = useToast();

  const remove = async () => {
    const confirmed = await dialog.confirm({
      title: `Remove ${props.project.name} from Loom?`,
      description: `Loom stops watching ${props.project.path}. Nothing on disk changes.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    await api.removeProject({ params: { id: props.project.id } });
    toast.success(`Removed ${props.project.name} from Loom`);
    if (props.selected) {
      await router.push("home");
    } else {
      await router.reload();
    }
  };

  return (
    <div className="group/item relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={`/projects/${props.project.id}`}
              className={cn(
                "focus-visible:ring-ring flex h-[22px] items-center gap-1.5 pr-7 pl-5 outline-none focus-visible:ring-1 focus-visible:ring-inset",
                props.selected
                  ? "bg-warp/20 text-accent-foreground"
                  : "hover:bg-sidebar-accent",
              )}
            />
          }
        >
          <FolderGit2
            className="text-muted-foreground size-4 shrink-0"
            strokeWidth={1.75}
          />
          <span className="truncate">{props.project.name}</span>
        </TooltipTrigger>
        <TooltipContent side="right">{props.project.path}</TooltipContent>
      </Tooltip>
      <button
        type="button"
        aria-label={`Remove ${props.project.name} from Loom`}
        onClick={() => void remove()}
        className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent absolute top-0 right-1 flex size-[22px] items-center justify-center rounded-sm opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};
