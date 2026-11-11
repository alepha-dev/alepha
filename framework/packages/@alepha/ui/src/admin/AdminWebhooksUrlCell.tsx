import * as React from "react";

void React;

export interface AdminWebhooksUrlCellProps {
  url: string;
}

/**
 * An endpoint's URL with its host emphasised and its path muted: the host
 * is what tells two endpoints apart.
 */
export const AdminWebhooksUrlCell = (props: AdminWebhooksUrlCellProps) => {
  let host = props.url;
  let rest = "";
  try {
    const parsed = new URL(props.url);
    host = parsed.host;
    rest = `${parsed.pathname}${parsed.search}`;
  } catch {
    // An unparsable URL is shown whole.
  }
  return (
    <span className="font-mono text-xs">
      <span className="text-foreground font-semibold">{host}</span>
      <span className="text-muted-foreground">{rest}</span>
    </span>
  );
};
