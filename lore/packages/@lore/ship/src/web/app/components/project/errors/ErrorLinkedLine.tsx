import { cn, textLinkUnderlineClassName } from "@alepha/ui";
import { Link } from "alepha/react/router";
import { Link2 } from "lucide-react";

export interface ErrorLinkedLineProps {
  /**
   * "Caused by server error #12", or "Caused browser error #13" on the server
   * side.
   */
  label: string;
  /**
   * The linked error's own page (#E185).
   */
  href: string;
}

/**
 * The line tying a browser error to the server error of the same request,
 * and back (#Q4404). It opens the other error's page.
 *
 * The click stops at the link, so it never fires the row underneath.
 */
const ErrorLinkedLine = (props: ErrorLinkedLineProps) => (
  <span
    className="text-muted-foreground flex items-center gap-1 text-xs"
    data-testid="error-linked"
  >
    <Link2 className="size-3 shrink-0" />
    <Link
      href={props.href}
      className={cn(textLinkUnderlineClassName, "hover:text-foreground")}
      onClick={(event) => event.stopPropagation()}
    >
      {props.label}
    </Link>
  </span>
);

export default ErrorLinkedLine;
