import { Switch, Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import { USER_DOCK_CAP } from "../../../../api/schemas/userDockCap.ts";
import type { I18n } from "../../services/I18n.ts";

export interface MyProjectsPinSwitchProps {
  project: { id: number; title: string; archivedAt?: string | null };
  pinned: boolean;
  /**
   * The dock holds the cap: an unpinned project's switch is held off, and
   * says why.
   */
  full: boolean;
  busy: boolean;
  onChange: (pinned: boolean) => void;
}

/**
 * The pin switch of one row of Account > Projects (#E139, #Q3440). Order is
 * not changed here, only membership of the dock: the order is the dock's.
 *
 * An archived project has no switch: it cannot be pinned, and archiving it
 * already took it off every dock.
 */
export const MyProjectsPinSwitch = (props: MyProjectsPinSwitchProps) => {
  const { tr } = useI18n<I18n, "en">();
  if (props.project.archivedAt) {
    return null;
  }
  const blocked = props.full && !props.pinned;
  const control = (
    <Switch
      checked={props.pinned}
      disabled={props.busy || blocked}
      onCheckedChange={props.onChange}
      aria-label={tr("account.projects.pin", { args: [props.project.title] })}
      data-testid="account-project-pin"
      data-project-id={props.project.id}
    />
  );
  if (!blocked) {
    return control;
  }
  // A disabled control fires no hover, so the reason sits on a wrapper.
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {control}
      </TooltipTrigger>
      <TooltipContent>
        {tr("dock.menu.full", { args: [String(USER_DOCK_CAP)] })}
      </TooltipContent>
    </Tooltip>
  );
};
