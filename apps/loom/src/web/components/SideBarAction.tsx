import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import type { LucideIcon } from "lucide-react";

export interface SideBarActionProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /**
   * Spins the icon, for a refresh that is under way.
   */
  spinning?: boolean;
}

/**
 * A 22px icon button in a side-bar section header.
 */
export const SideBarAction = (props: SideBarActionProps) => {
  const Icon = props.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            onClick={props.onClick}
            className="text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-ring flex size-[22px] items-center justify-center rounded-sm outline-none focus-visible:ring-1"
          />
        }
      >
        <Icon
          className={props.spinning ? "size-4 animate-spin" : "size-4"}
          strokeWidth={1.75}
        />
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
};
