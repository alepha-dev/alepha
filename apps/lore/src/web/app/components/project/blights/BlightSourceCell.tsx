import { OutboundLink } from "../../shared/OutboundLink.tsx";
import { blightSourceHref } from "./blightSourceHref.ts";

export interface BlightSourceCellProps {
  sourceUrl?: string;
}

/**
 * A blight's Page cell: a link out when `sourceUrl` is an http(s) page, plain
 * text for a route pattern, a job name or anything else (feedback #P2200).
 *
 * Both shapes truncate to the column and carry the full value in `title`,
 * since a clipped route is only readable on hover.
 *
 * ⚠️ Attacker-controlled: rendered as text by React, and an `href` only after
 * {@link blightSourceHref} has allowed the scheme.
 *
 * The click stops at the link, so a row action added to the inbox later
 * cannot fire underneath a link that has just opened a tab.
 */
const BlightSourceCell = (props: BlightSourceCellProps) => {
  if (!props.sourceUrl) {
    return <span className="text-muted-foreground text-xs">-</span>;
  }

  const href = blightSourceHref(props.sourceUrl);
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

export default BlightSourceCell;
