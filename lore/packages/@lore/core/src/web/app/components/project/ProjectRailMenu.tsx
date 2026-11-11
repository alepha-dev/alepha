import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  useToast,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Link2, Pin, PinOff, SquareArrowOutUpRight } from "lucide-react";

import { USER_DOCK_CAP } from "../../../../api/schemas/userDockCap.ts";
import type { I18n } from "../../services/I18n.ts";

export interface ProjectRailMenuProps {
  project: { id: number; slug: string };
  /**
   * On the dock: the menu offers Unpin. Off it (the temporary slot): Pin.
   */
  pinned: boolean;
  /**
   * The dock holds the cap already: Pin is drawn disabled, with the reason.
   */
  full: boolean;
  /**
   * A pin or unpin is in flight: both are held until it lands.
   */
  busy?: boolean;
  onPin: () => void;
  onUnpin: () => void;
}

/**
 * What right-clicking a dock icon offers (#E139, #Q3439): Unpin (Pin on the
 * temporary slot), Open in new tab, Copy link.
 *
 * Unpinning the project being looked at does not make it vanish: off the
 * dock, it is the temporary slot's, the rail's own rule.
 */
export const ProjectRailMenu = (props: ProjectRailMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const toaster = useToast();
  const path = router.path("project", {
    params: { projectSlug: props.project.slug },
  });

  return (
    <ContextMenuContent data-testid="project-rail-menu">
      {props.pinned ? (
        <ContextMenuItem
          data-testid="project-rail-menu-unpin"
          disabled={props.busy}
          onClick={props.onUnpin}
        >
          <PinOff className="size-4" />
          {tr("dock.menu.unpin")}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem
          data-testid="project-rail-menu-pin"
          disabled={props.full || props.busy}
          onClick={props.onPin}
        >
          <Pin className="size-4" />
          <div className="flex flex-col">
            <span>{tr("dock.menu.pin")}</span>
            {props.full && (
              <span className="text-muted-foreground text-xs">
                {tr("dock.menu.full", { args: [String(USER_DOCK_CAP)] })}
              </span>
            )}
          </div>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        data-testid="project-rail-menu-new-tab"
        onClick={() => window.open(path, "_blank", "noopener,noreferrer")}
      >
        <SquareArrowOutUpRight className="size-4" />
        {tr("dock.menu.open-new-tab")}
      </ContextMenuItem>
      <ContextMenuItem
        data-testid="project-rail-menu-copy"
        onClick={() => {
          const url = new URL(path, window.location.origin).href;
          void navigator.clipboard
            .writeText(url)
            .then(() => toaster.success(tr("dock.menu.copied")));
        }}
      >
        <Link2 className="size-4" />
        {tr("dock.menu.copy-link")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
};
