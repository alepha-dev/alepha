import { cn } from "@alepha/ui/lib/utils";
import { type LucideIcon, X } from "lucide-react";

export interface EditorTabProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
  /**
   * Absent on a tab that cannot close, such as Overview.
   */
  onClose?: () => void;
}

/**
 * An editor tab: the active one takes the editor's background and a warp
 * line along its top edge, the others sit on the frame. A middle click
 * closes, as in any editor.
 */
export const EditorTab = (props: EditorTabProps) => {
  const Icon = props.icon;
  return (
    <div
      onAuxClick={(event) => {
        if (event.button === 1 && props.onClose) {
          props.onClose();
        }
      }}
      className={cn(
        "group/tab border-border relative flex h-full shrink-0 items-center border-r",
        props.active
          ? "bg-background text-foreground before:bg-warp before:absolute before:inset-x-0 before:top-0 before:h-px"
          : "bg-frame text-muted-foreground hover:text-foreground",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.active}
        onClick={props.onSelect}
        className="focus-visible:ring-ring flex h-full items-center gap-1.5 pr-1 pl-3 outline-none focus-visible:ring-1 focus-visible:ring-inset"
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="max-w-48 truncate">{props.label}</span>
      </button>
      {props.onClose ? (
        <button
          type="button"
          aria-label={`Close ${props.label}`}
          onClick={props.onClose}
          className={cn(
            "hover:bg-accent mr-1 flex size-5 items-center justify-center rounded-sm focus-visible:opacity-100",
            props.active
              ? "opacity-100"
              : "opacity-0 group-hover/tab:opacity-100",
          )}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <span className="w-3" />
      )}
    </div>
  );
};
