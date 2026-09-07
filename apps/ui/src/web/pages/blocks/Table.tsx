import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
import { z } from "alepha";
import type { Page } from "alepha";
import { useClient } from "alepha/react";
import { Search, UserPlus } from "lucide-react";
import { useCallback } from "react";

import type { ShowcaseMember } from "@/showcase/ShowcaseMembers.ts";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The one page that exercises the data path end to end: `useClient` resolves
 * `LinkProvider`, which reads the action registry and dispatches
 * `findShowcaseMembers` - in process during SSR, over HTTP in the browser.
 */
const KNOBS = z.object({
  // `50` is here so "Full height" has something to prove: at 20 rows the body
  // only overflows on a short viewport, and a scroller nobody can see is
  // indistinguishable from one that does not work.
  pageSize: z
    .enum(["5", "10", "20", "50"])
    .default("10")
    .meta({ title: "Page size" }),
  selectable: z.boolean().default(true).meta({ title: "Row selection" }),
  filters: z.boolean().default(true).meta({ title: "Filter toolbar" }),
  // Both empty states, reachable from the panel. "No match" is not faked: it
  // seeds the search box with a term the fixture cannot match, so the state
  // is produced by the same filter detection a reader's own typing would go
  // through.
  //
  // "Custom" is that same no-filter state dressed by the caller, which is what
  // a real page does with `emptyState`: the table is empty because the reader
  // has not created anything yet, and the answer to that is a button, not an
  // apology. Worth a slot of its own because the stock wording is the least
  // interesting thing a table can say when it is empty.
  emptyState: z
    .enum(["Off", "No items", "No match", "Custom"])
    .default("Off")
    .meta({ title: "Empty state" }),
  // The layout an application actually mounts this in: the table takes the
  // pane's height and its BODY scrolls, so the filter bar and the pagination
  // footer stay put and the sticky header stays against the top of the rows.
  // Off by default because the page's other blocks grow with their content and
  // a table that swallows the viewport would read as a bug next to them.
  fullHeight: z.boolean().default(false).meta({ title: "Full height" }),
  hideTeam: z.boolean().default(false).meta({ title: "Hide team column" }),
  hideRole: z.boolean().default(false).meta({ title: "Hide role column" }),
});

const filtersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
});

/**
 * "No items" is the one state the fixture cannot reach on its own: it always
 * has 75 rows, and everything that narrows them to zero is a filter, which is
 * the OTHER state. So this answers with an empty page instead of asking the
 * server.
 */
const fetchNothing = async (): Promise<Page<ShowcaseMember>> => ({
  content: [],
  page: {
    number: 0,
    size: 10,
    offset: 0,
    numberOfElements: 0,
    totalElements: 0,
    totalPages: 1,
    isEmpty: true,
    isFirst: true,
    isLast: true,
  },
});

const STATUS_TONE: Record<string, "success" | "warning" | "danger"> = {
  active: "success",
  invited: "warning",
  disabled: "danger",
};

const Table = () => {
  const toast = useToast();
  const client = useClient() as unknown as {
    findShowcaseMembers: (a: {
      query: Record<string, unknown>;
    }) => Promise<Page<ShowcaseMember>>;
  };

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: { search?: string; status?: string };
    }) =>
      client.findShowcaseMembers({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          // Never pass undefined into a filter: an empty box omits the key.
          search: params.filters?.search || undefined,
          status: params.filters?.status || undefined,
        },
      }),
    [client],
  );

  return (
    <Showcase
      id="blocks/Table"
      title="Table"
      description="Server-paged, filtered and sortable."
      fill
      schema={KNOBS}
      initialValues={{
        pageSize: "10",
        selectable: true,
        filters: true,
        emptyState: "Off",
        fullHeight: false,
        hideTeam: false,
        hideRole: false,
      }}
    >
      {(v) => (
        <AlephaTable<ShowcaseMember>
          // `defaultSize`, `defaultHidden`, `persistenceKey` and `seedValues`
          // are read at mount, so every knob that feeds one has to be in this
          // key or the switch moves and the table does not. `fullHeight` is
          // deliberately absent: it feeds a class, and remounting on it would
          // throw the fetch away to change a style.
          key={`${v.pageSize}-${v.selectable}-${v.filters}-${v.emptyState}-${v.hideTeam}-${v.hideRole}`}
          className={cn("min-h-0", v.fullHeight && "flex-1")}
          // Dropped while an empty state is forced. Persistence would
          // otherwise decide which of the two states appears: a search left in
          // the box from an earlier visit is still an active filter, so "No
          // items" would quietly render "No match".
          persistenceKey={v.emptyState === "Off" ? "ui.members" : undefined}
          fetch={
            v.emptyState === "No items" || v.emptyState === "Custom"
              ? fetchNothing
              : fetcher
          }
          // Only the custom slot is filled here. The other three modes are
          // showing what the table says on its own, which is the point of
          // having them next to this one.
          emptyState={
            v.emptyState === "Custom"
              ? {
                  icon: UserPlus,
                  title: "No members yet",
                  description:
                    "Invite someone and they will show up here, with their team and role.",
                  action: (
                    <Button
                      size="sm"
                      onClick={() => toast.success("Invitation sent")}
                    >
                      <UserPlus />
                      Invite a member
                    </Button>
                  ),
                }
              : undefined
          }
          defaultSize={Number(v.pageSize)}
          filters={
            // "No match" implies the filter bar, whatever the toolbar knob
            // says: the state only exists when something is filtering, so the
            // combination the knob would otherwise allow has no meaning.
            v.filters || v.emptyState === "No match"
              ? {
                  schema: filtersSchema,
                  // Linkable, which is what puts the toolbar's filter MENU
                  // (Share + Reset) in place of the bare reset icon button.
                  // The showcase is the only place both shapes can be
                  // compared, so it demonstrates the one that has more in it.
                  fromQuery: true,
                  seedValues:
                    v.emptyState === "No match"
                      ? { search: "nobody" }
                      : undefined,
                  render: (form) => (
                    <div className="flex items-center gap-2">
                      <div className="w-64">
                        <Control
                          input={form.input.search}
                          label=""
                          icon={Search}
                          placeholder="Search members"
                        />
                      </div>
                      <div className="w-44">
                        <Control input={form.input.status} label="" />
                      </div>
                    </div>
                  ),
                }
              : undefined
          }
          bulkActions={
            v.selectable
              ? [
                  {
                    label: "Export selected",
                    onClick: (items, ctx) => {
                      ctx.clearSelection();
                      return Promise.resolve(void items);
                    },
                  },
                ]
              : undefined
          }
          columns={{
            // `sortable` is opt-in per COLUMN, and without it the header is
            // inert however well the server sorts. `ShowcaseMembers` has
            // honoured `sort` from the beginning and the fetcher has always
            // forwarded it, so the whole path worked except for the one flag
            // that lets a reader reach it - and this page's own description
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
                <span className="text-muted-foreground truncate">
                  {m.email}
                </span>
              ),
            },
            // `defaultHidden` is per COLUMN: the table has no
            // defaultHiddenColumns prop, that one belongs to AdminUsers.
            team: {
              label: "Team",
              sortable: true,
              defaultHidden: v.hideTeam,
              cell: (m) => m.team,
            },
            role: {
              label: "Role",
              defaultHidden: v.hideRole,
              cell: (m) => <Badge variant="outline">{m.role}</Badge>,
            },
            status: {
              label: "Status",
              // `tone` is only meaningful with variant="tint": every other
              // variant paints its own background and leaves the label
              // unreadable over a pale tint.
              cell: (m) => (
                <Badge variant="tint" tone={STATUS_TONE[m.status]}>
                  {m.status}
                </Badge>
              ),
            },
          }}
        />
      )}
    </Showcase>
  );
};

export default Table;
