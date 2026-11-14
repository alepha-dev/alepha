import { OutboundLink } from "@lore/core/web";

import { errorSourceHref } from "./errorSourceHref.ts";

export interface ErrorSourceCellProps {
  sourceUrl?: string;
}

/**
 * An error's Page cell: a link out when `sourceUrl` is an http(s) page, plain
 * text for a route pattern, a job name or anything else (feedback #P2200).
 *
 * Both shapes truncate to the column and carry the full value in `title`,
 * since a clipped route is only readable on hover.
 *
 * ⚠️ Attacker-controlled: rendered as text by React, and an `href` only after
 * {@link errorSourceHref} has allowed the scheme.
 *
 * The click stops at the link, so a row action added to the inbox later
 * cannot fire underneath a link that has just opened a tab.
 */
const ErrorSourceCell = (props: ErrorSourceCellProps) => {
  if (!props.sourceUrl) {
    return <span className="text-muted-foreground text-xs">-</span>;
  }

  const href = errorSourceHref(props.sourceUrl);
  if (href) {
    return (
      <OutboundLink
        href={href}
        title={props.sourceUrl}
        rel="noopener noreferrer"
        className="text-xs hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {props.sourceUrl}
      </OutboundLink>
    );
  }

  return (
    <span
      className="text-muted-foreground block truncate text-xs"
      title={props.sourceUrl}
    >
      {props.sourceUrl}
    </span>
  );
};

export default ErrorSourceCell;
