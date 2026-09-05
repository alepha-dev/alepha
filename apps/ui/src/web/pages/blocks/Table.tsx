import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { z } from "alepha";
import type { Page } from "alepha";
import { useClient } from "alepha/react";
import { Search } from "lucide-react";
import { useCallback } from "react";

import type { ShowcaseMember } from "@/showcase/ShowcaseMembers.ts";
import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

const filtersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
});

const STATUS_TONE: Record<string, "success" | "warning" | "danger"> = {
  active: "success",
  invited: "warning",
  disabled: "danger",
};

/**
 * The one page on this site that exercises the data path end to end.
 *
 * Every other block renders from props. This one takes the real route an app
 * takes: `useClient` resolves `LinkProvider`, which reads the action registry
 * and dispatches `findShowcaseMembers` - in process during SSR, over HTTP to
 * `ShowcaseController` in the browser. If that path breaks, this table is
 * where it shows first.
 *
 * A `data` table would prove none of it: the table holds its fetcher in a ref
 * excluded from the load effect, so static rows bypass the fetch path entirely.
 */
const Table = () => {
  // `useClient<ShowcaseController>()` would type this for free, but the
  // controller is server-only code and importing it here would pull `$action`
  // and its handler into the browser bundle. A hand-written shape keeps the
  // call site typed without that.
  const client = useClient() as unknown as ShowcaseMembersClient;

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
          // Never pass `undefined` into a filter: an empty search box must
          // omit the key, not send it empty.
          search: params.filters?.search || undefined,
          status: params.filters?.status || undefined,
        },
      }),
    [client],
  );

  return (
    <BlockPage
      title="AlephaTable"
      source="@alepha/ui/components/alepha-table/alepha-table"
      description="A table that pages, sorts and filters on the server. Filters are a zod schema rendered into a toolbar, selection drives bulk actions, and the column picker is built in."
    >
      <Specimen
        title="Server-paged, filtered and sortable"
        description="Backed by a fetcher. Paging, sorting and both filters are resolved by the transport, not in the browser."
      >
        <AlephaTable<ShowcaseMember>
          className="min-h-0"
          persistenceKey="ui.members"
          fetch={fetcher}
          filters={{
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
          }}
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
            team: { label: "Team", cell: (m) => m.team },
            role: {
              label: "Role",
              cell: (m) => <Badge variant="outline">{m.role}</Badge>,
            },
            status: {
              label: "Status",
              // `tone` is only meaningful with `variant="tint"`: every other
              // variant paints its own background, and the label then keeps
              // `text-primary-foreground` over a pale tint - which is the
              // unreadable chip this page caught the first time it rendered.
              cell: (m) => (
                <Badge variant="tint" tone={STATUS_TONE[m.status]}>
                  {m.status}
                </Badge>
              ),
            },
          }}
        />
      </Specimen>
    </BlockPage>
  );
};

interface ShowcaseMembersClient {
  findShowcaseMembers: (args: {
    query: {
      page: number;
      size: number;
      sort?: string;
      search?: string;
      status?: string;
    };
  }) => Promise<Page<ShowcaseMember>>;
}

export default Table;
