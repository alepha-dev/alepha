import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
  type DataTableSummaryFetcher,
} from "@alepha/ui/table";
import { z } from "alepha";
import type { Page } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { MailPlus, UserCheck, Users, UsersRound } from "lucide-react";
import { useCallback } from "react";

import type {
  ShowcaseMember,
  ShowcaseMemberStats,
} from "@/showcase/ShowcaseMembers.ts";
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
 *
 * Above the filter bar, the summary panel: four figures fetched with the same
 * filter, so picking "Invited" recounts every invited member rather than the
 * page on screen. And behind the `?` at the end of the icons, the page's help.
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
  const { l } = useI18n();
  const client = useClient() as unknown as {
    findShowcaseMembers: (a: {
      query: Record<string, unknown>;
    }) => Promise<Page<ShowcaseMember>>;
    findShowcaseMemberStats: (
      a: { query: Record<string, unknown> },
      o: { request: { signal: AbortSignal } },
    ) => Promise<ShowcaseMemberStats>;
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

  const fetchSummary = useCallback<
    DataTableSummaryFetcher<typeof FILTER_FIELDS>
  >(
    async ({ filters, signal }) => {
      const stats = await client.findShowcaseMemberStats(
        {
          query: {
            status:
              filters?.status && filters.status !== "all"
                ? filters.status
                : undefined,
          },
        },
        { request: { signal } },
      );
      return [
        { label: "Members", value: l(stats.total), icon: Users },
        { label: "Active", value: l(stats.active), icon: UserCheck },
        {
          label: "Invited",
          value: l(stats.invited),
          icon: MailPlus,
          hint: "Yet to sign in",
          // The one figure that asks for something: an invitation nobody
          // has answered.
          tone: stats.invited > 0 ? "warning" : undefined,
        },
        { label: "Teams", value: l(stats.teams), icon: UsersRound },
      ];
    },
    [client, l],
  );

  return (
    <Showcase
      id="blocks/data-table/Addons"
      title="DataTable: addons"
      description="The same members, with the table's add-ons: a locked filter, a summary counted over the filtered set, and a help card."
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
          summary={{ fetch: fetchSummary }}
          help={
            <div className="flex flex-col gap-1.5">
              <p className="font-medium">How this list is counted</p>
              <p className="text-muted-foreground">
                Members are paged, sorted and filtered on the server. The
                summary above the filters counts every member the status
                matches, not only the page on screen.
              </p>
            </div>
          }
          columns={memberColumns}
        />
      )}
    </Showcase>
  );
};

export default Addons;
