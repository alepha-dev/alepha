import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { Link2 } from "lucide-react";

import type { ProjectErrorResource } from "../../../../../api/schemas/projectErrorResourceSchema.ts";

export interface ErrorLinkedLineProps {
  /**
   * "Caused by server error #12", or "Caused browser error #13" on the server
   * side.
   */
  label: string;
  /**
   * The linked group, when the inbox holds it: the line then opens its stack
   * trace. Plain text otherwise.
   */
  linked?: ProjectErrorResource;
  onOpen: (error: ProjectErrorResource) => void;
}

/**
 * The line tying a browser error to the server error of the same request,
 * and back (#Q4404).
 *
 * The click stops at the button, so it never fires the row underneath.
 */
const ErrorLinkedLine = (props: ErrorLinkedLineProps) => {
  const linked = props.linked;
  return (
    <span
      className="text-muted-foreground flex items-center gap-1 text-xs"
      data-testid="error-linked"
    >
      <Link2 className="size-3 shrink-0" />
      {linked ? (
        <button
          type="button"
          className={cn(textLinkUnderlineClassName, "hover:text-foreground")}
          onClick={(event) => {
            event.stopPropagation();
            props.onOpen(linked);
          }}
        >
          {props.label}
        </button>
      ) : (
        props.label
      )}
    </span>
  );
};

export default ErrorLinkedLine;
