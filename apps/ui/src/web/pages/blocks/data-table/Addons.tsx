import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import { z } from "alepha";
import type { Page } from "alepha";
import { useClient } from "alepha/react";
import { useCallback } from "react";

import type { ShowcaseMember } from "@/showcase/ShowcaseMembers.ts";
import { Showcase } from "@/web/components/Showcase.tsx";
import { memberColumns } from "@/web/pages/blocks/data-table/memberColumns.tsx";

/**
 * The Basic page's rows and columns, with the table's add-ons laid on top.
 *
 * The first one is a filter the reader cannot take off the bar: the status,
 * drawn as a segmented control. `mode: "locked"` keeps it on the bar with no
 * remove button, and `control.segmented` swaps the select for a row of
 * segments, which suits a short choice read at a glance.
 *
 * ⚠️ "All" is an option of its own. A segmented control has no empty state to
 * go back to: once a segment is picked, another segment is the only way out,
 * so the choice meaning "no filter" has to be one of them. The fetcher turns
 * it back into an absent key.
 */
const FILTER_FIELDS = {
  status: {
    schema: z.enum(["all", "active", "invited", "disabled"]),
    label: "Status",
    mode: "locked",
    optionLabel: (status: string) =>
      status.charAt(0).toUpperCase() + status.slice(1),
    control: { segmented: true },
  },
} satisfies DataTableFilterFields;

const Addons = () => {
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
      filters?: DataTableFilterValues<typeof FILTER_FIELDS>;
    }) =>
      client.findShowcaseMembers({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          status:
            params.filters?.status && params.filters.status !== "all"
              ? params.filters.status
              : undefined,
        },
      }),
    [client],
  );

  return (
    <Showcase
      id="blocks/data-table/Addons"
      title="DataTable: addons"
      description="The same members, with the table's add-ons."
      fill
    >
      {() => (
        <DataTable<ShowcaseMember, typeof FILTER_FIELDS>
          className="min-h-0 flex-1"
          persistenceKey="ui.members.addons"
          fetch={fetcher}
          filters={{
            fields: FILTER_FIELDS,
            initialValues: { status: "all" },
          }}
          columns={memberColumns}
        />
      )}
    </Showcase>
  );
};

export default Addons;
