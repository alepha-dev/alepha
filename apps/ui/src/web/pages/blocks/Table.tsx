import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { z } from "alepha";
import type { Page } from "alepha";
import { useClient } from "alepha/react";
import { Search } from "lucide-react";
import { useCallback } from "react";

import type { ShowcaseMember } from "@/showcase/ShowcaseMembers.ts";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The one page that exercises the data path end to end: `useClient` resolves
 * `LinkProvider`, which reads the action registry and dispatches
 * `findShowcaseMembers` - in process during SSR, over HTTP in the browser.
 */
const KNOBS = z.object({
  pageSize: z
    .enum(["5", "10", "20"])
    .default("10")
    .meta({ title: "Page size" }),
  selectable: z.boolean().default(true).meta({ title: "Row selection" }),
  filters: z.boolean().default(true).meta({ title: "Filter toolbar" }),
  hideTeam: z.boolean().default(false).meta({ title: "Hide team column" }),
  hideRole: z.boolean().default(false).meta({ title: "Hide role column" }),
});

const filtersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
});

const STATUS_TONE: Record<string, "success" | "warning" | "danger"> = {
  active: "success",
  invited: "warning",
  disabled: "danger",
};

const Table = () => {
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
      schema={KNOBS}
      initialValues={{
        pageSize: "10",
        selectable: true,
        filters: true,
        hideTeam: false,
        hideRole: false,
      }}
    >
      {(v) => (
        <AlephaTable<ShowcaseMember>
          // `defaultSize` and `defaultHidden` are read at mount, so every knob
          // that feeds one has to be in this key or the switch moves and the
          // table does not.
          key={`${v.pageSize}-${v.selectable}-${v.filters}-${v.hideTeam}-${v.hideRole}`}
          className="min-h-0"
          persistenceKey="ui.members"
          fetch={fetcher}
          defaultSize={Number(v.pageSize)}
          filters={
            v.filters
              ? {
                  schema: filtersSchema,
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
            name: {
              label: "Name",
              cell: (m) => <span className="font-medium">{m.name}</span>,
            },
            email: {
              label: "Email",
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
