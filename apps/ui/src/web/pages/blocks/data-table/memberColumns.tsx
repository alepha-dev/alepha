import { Badge } from "@alepha/ui";
import type { ColumnDef } from "@alepha/ui/table";

import type { ShowcaseMember } from "@/showcase/ShowcaseMembers.ts";

const STATUS_TONE: Record<string, "success" | "warning" | "danger"> = {
  active: "success",
  invited: "warning",
  disabled: "danger",
};

/**
 * The members' columns, shared by every Table page so each one shows the same
 * rows the same way and differs only in what it adds around them.
 */
export const memberColumns: Record<string, ColumnDef<ShowcaseMember>> = {
  // `sortable` is opt-in per COLUMN, and without it the header is
  // inert however well the server sorts. `ShowcaseMembers` has
  // honoured `sort` from the beginning and the fetcher has always
  // forwarded it, so the whole path worked except for the one flag
  // that lets a reader reach it - and the Basic page's own description
  // says "sortable".
  name: {
    label: "Name",
    sortable: true,
    cell: (m) => <span className="font-medium">{m.name}</span>,
  },
  email: {
    label: "Email",
    sortable: true,
    cell: (m) => (
      <span className="text-muted-foreground truncate">{m.email}</span>
    ),
  },
  // Both columns start visible. Hiding one is what the "Toggle
  // columns" menu is for, and a knob doing the same thing from the
  // side panel only made the menu look decorative. (`defaultHidden`
  // is per COLUMN, if a page wants one hidden from the start: the
  // table has no defaultHiddenColumns prop, that one belongs to
  // AdminUsers.)
  team: {
    label: "Team",
    sortable: true,
    cell: (m) => m.team,
  },
  role: {
    label: "Role",
    cell: (m) => <Badge variant="outline">{m.role}</Badge>,
  },
  tags: {
    label: "Tags",
    cell: (m) => (
      <div className="flex flex-wrap gap-1">
        {m.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
      </div>
    ),
  },
  status: {
    label: "Status",
    // `tone` is only meaningful with variant="tint": every other
    // variant paints its own background and leaves the label
    // unreadable over a pale tint.
    cell: (m) => (
      <Badge variant="tint" tone={STATUS_TONE[m.status]}>
        {/* Capitalized for display only; the row still holds the
            lowercase value the filter matches on. */}
        {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
      </Badge>
    ),
  },
};
