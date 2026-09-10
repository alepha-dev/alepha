import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import type { ReactNode } from "react";

export interface WorktreeViewSessionsLinkProps {
  /**
   * A `claude://code/new` URL.
   */
  href: string;
  label: string;
  /**
   * What the session will be asked, shown on hover.
   */
  hint: string;
  icon: ReactNode;
}

/**
 * One session link: a small outlined button that is really an anchor, so the
 * browser hands the `claude://` URL to the desktop app.
 */
export const WorktreeViewSessionsLink = (
  props: WorktreeViewSessionsLinkProps,
) => {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={props.href} />}
          />
        }
      >
        {props.icon}
        {props.label}
      </TooltipTrigger>
      <TooltipContent>{props.hint}</TooltipContent>
    </Tooltip>
  );
};
