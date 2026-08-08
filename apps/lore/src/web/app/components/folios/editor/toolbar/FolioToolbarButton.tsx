import { Button } from "@alepha/ui/components/ui/button";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

export interface FolioToolbarButtonProps {
  label: string;
  icon: LucideIcon;
  /**
   * Whether the format is currently applied at the caret. Rendered as
   * `aria-pressed` as well as a filled look — a toolbar toggle that only
   * signals its state through colour is invisible to a screen reader.
   */
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * One toolbar control, built on the house `Button` rather than MDXEditor's
 * own toolbar primitives.
 *
 * The library's components carry their own markup and sizing, which the
 * workspace could only fight with CSS overrides scoped to a wrapper class
 * — they never matched the Save button or the Segmented switch sharing
 * their row. Driving `Button` directly costs one wiring line per control
 * (the dispatchers already exist in `useEditorRealmCommands`, the states in
 * MDXEditor's realm cells) and gives the row a single, consistent set of
 * shadcn controls.
 */
const FolioToolbarButton = (props: FolioToolbarButtonProps): ReactElement => {
  const Icon = props.icon;
  return (
    <Button
      type="button"
      size="icon-sm"
      variant={props.active ? "secondary" : "ghost"}
      aria-pressed={props.active}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon className="size-4" />
    </Button>
  );
};

export default FolioToolbarButton;
