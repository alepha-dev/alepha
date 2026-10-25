import * as React from "react";

void React;

import { Link } from "alepha/react/router";

export interface AdminUserCellProps {
  /**
   * The user's id — the link target. Without it the cell renders unlinked:
   * there is no detail page to point at.
   */
  userId?: string | null;
  /**
   * Slim user summary as embedded by admin listings (sessions, API keys,
   * files, payments). When absent the cell falls back to `fallbackLabel`,
   * then the truncated id — a deleted account is real data, and showing
   * nothing would read as a rendering bug.
   */
  user?: {
    email?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  };
  /**
   * Last-resort display label before the truncated id — for rows that carry
   * a denormalized snapshot instead of (or besides) a live summary, like the
   * audit log's `userEmail` or a file's `creatorName`.
   */
  fallbackLabel?: string;
}

/**
 * The one way an admin table cell names a user: best available identifier
 * (email, then username, then real name, then the caller's snapshot label),
 * linked to the user detail page whenever an id is present.
 *
 * A real `<a href>` rather than a click handler, so the cell keeps
 * cmd-click, middle-click and "copy link address" — same reasoning as the
 * owner column on Lore's admin projects page.
 */
export const AdminUserCell = (props: AdminUserCellProps) => {
  const label =
    props.user?.email ||
    props.user?.username ||
    [props.user?.firstName, props.user?.lastName].filter(Boolean).join(" ") ||
    props.fallbackLabel ||
    null;

  if (!props.userId) {
    return label ? (
      <span className="truncate text-sm">{label}</span>
    ) : (
      <span className="text-muted-foreground text-xs">—</span>
    );
  }

  return (
    <Link
      href={`/admin/users/${props.userId}`}
      className="hover:text-foreground underline-offset-4 hover:underline"
    >
      {label ?? (
        <code className="text-muted-foreground font-mono text-xs">
          {props.userId.slice(0, 8)}
        </code>
      )}
    </Link>
  );
};
