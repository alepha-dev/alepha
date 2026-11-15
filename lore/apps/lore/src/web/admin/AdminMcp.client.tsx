import { Badge } from "@alepha/ui";
import { AdminPage } from "@alepha/ui/admin";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import type { AdminMcpController } from "@lore/core/api";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { CalendarDays, CircleDot } from "lucide-react";
import { useCallback, useState } from "react";

import { AdminMcpCallsChart } from "./AdminMcpCallsChart.client.tsx";
import { AdminMcpRows, type McpToolRow } from "./adminMcpRows.ts";

type McpCalls = Awaited<ReturnType<AdminMcpController["readMcpCalls"]>>;

/**
 * What the MCP surface is asked for, over thirty days (#E65).
 *
 * ## The chart that could not be drawn before this epic
 *
 * MCP is Lore's primary consumer and a tool call leaves no row in any entity
 * table. A write eventually appears in the audit log; a read does not, and
 * reads are most of the traffic. So until `mcp_calls` existed, "which tools
 * do agents actually call" had no answer in any surface of this app - not a
 * partial one, not a slow one, none. That is what makes it the honest test of
 * the premise this epic rested on: the store is worth more than a daily
 * counts table in D1 only if a family of event-rate charts exists, and a
 * counts table could not have served this one either, because nothing was
 * ever stored to count.
 *
 * ## Two halves, and the second is the useful one
 *
 * The timeline says how much. The table says how those calls ENDED, and that
 * is what a tool's author acts on: a tool called constantly that refuses half
 * its calls has a description or a schema that misleads the model, and a tool
 * that ERRORS is simply broken. A single "failures" number would say neither,
 * which is why the dataset keeps `refused` and `error` apart.
 *
 * ## One table, the chart above its rows (#Q2498)
 *
 * The per-tool rows are a `DataTable` in static-data mode, sortable, and the
 * thirty-day chart is its summary addon, the way `/admin/files` mounts its
 * storage tile. The page title and description went: the admin nav already
 * names the page, and the chart says what it counts.
 *
 * ## Filters (#Q3665)
 *
 * A tool search, an outcome and a period (7, 30 or 90 days), applied by the
 * server so the chart and the rows answer the same question. The table
 * fetches, and the chart draws what that fetch answered.
 *
 * Literal English, like every other page in the Lore admin: this shell is
 * untranslated.
 */
export const AdminMcp = () => {
  const client = useClient<AdminMcpController>();
  // The read the table's fetch made last, which the chart above it draws:
  // one request answers both, so the two cannot disagree about the filters.
  const [data, setData] = useState<McpCalls>();
  const [loading, setLoading] = useState(true);

  // Filters (#Q3665): a search on the tool name, an outcome and a period,
  // all applied by `readMcpCalls`, so the chart follows them too. Seeded from
  // the URL (`?outcome=error&days=7`), so a link carries a narrowed view.
  const filterFields = {
    search: {
      preset: "search",
      placeholder: "Search tools…",
      control: { inputProps: { "aria-label": "Search tools by name" } },
    },
    outcome: {
      schema: z.enum(["ok", "refused", "error"]),
      label: "Outcome",
      icon: CircleDot,
      items: [
        { value: "ok", label: "OK" },
        { value: "refused", label: "Refused" },
        { value: "error", label: "Error" },
      ],
      control: { clearLabel: "Any outcome" },
    },
    days: {
      schema: z.enum(["7", "30", "90"]),
      label: "Period",
      icon: CalendarDays,
      items: [
        { value: "7", label: "7 days" },
        { value: "30", label: "30 days" },
        { value: "90", label: "90 days" },
      ],
      control: { clearLabel: "30 days" },
    },
  } satisfies DataTableFilterFields;

  // Stable, so the state it writes never re-runs it.
  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: DataTableFilterValues<typeof filterFields>;
    }) => {
      setLoading(true);
      try {
        const read = await client.readMcpCalls({
          query: {
            ...(params.filters?.days ? { days: params.filters.days } : {}),
            ...(params.filters?.outcome
              ? { outcome: params.filters.outcome }
              : {}),
            ...(params.filters?.search?.trim()
              ? { tool: params.filters.search.trim() }
              : {}),
          },
        });
        setData(read);
        const rows = AdminMcpRows.sorted(read.leaderboard, params.sort);
        const offset = params.page * params.size;
        return {
          content: rows.slice(offset, offset + params.size),
          page: {
            number: params.page,
            size: params.size,
            offset,
            numberOfElements: Math.min(params.size, rows.length - offset),
            totalElements: rows.length,
            totalPages: Math.max(1, Math.ceil(rows.length / params.size)),
            isEmpty: rows.length === 0,
            isFirst: params.page === 0,
            isLast: offset + params.size >= rows.length,
            sort: { sorted: true, fields: [] },
          },
        };
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  return (
    <AdminPage>
      <DataTable<McpToolRow, typeof filterFields>
        className="min-h-0 flex-1"
        fetch={fetcher}
        rowKey={(row) => row.tool}
        persistenceKey="admin.mcp"
        defaultSort={{ field: "total", direction: "desc" }}
        filters={{ fields: filterFields, fromQuery: true }}
        summary={{
          title: `Calls, last ${data?.days.length ?? 30} days`,
          content: <AdminMcpCallsChart data={data} loading={loading} />,
        }}
        emptyState={{
          title: loading ? "Reading…" : "No tool has been called yet.",
        }}
        noMatchState={{ title: "No tool matches these filters." }}
        columns={{
          tool: {
            label: "Tool",
            sortable: true,
            sortValue: (row) => row.tool,
            cell: (row) => (
              <span className="font-mono text-xs">{row.tool}</span>
            ),
          },
          total: {
            label: "Calls",
            align: "right",
            sortable: true,
            sortValue: (row) => row.total,
            cell: (row) => <span className="tabular-nums">{row.total}</span>,
          },
          ok: {
            label: "OK",
            align: "right",
            sortable: true,
            sortValue: (row) => row.ok,
            cell: (row) => <span className="tabular-nums">{row.ok}</span>,
          },
          refused: {
            label: "Refused",
            align: "right",
            sortable: true,
            sortValue: (row) => row.refused,
            // A refusal is the API working: the agent asked for something it
            // may not have, or malformed. Worth seeing, never red.
            cell: (row) =>
              row.refused > 0 ? (
                <Badge variant="secondary">{row.refused}</Badge>
              ) : (
                <span className="tabular-nums">{row.refused}</span>
              ),
          },
          errors: {
            label: "Errors",
            align: "right",
            sortable: true,
            sortValue: (row) => row.errors,
            cell: (row) =>
              row.errors > 0 ? (
                <Badge variant="destructive">{row.errors}</Badge>
              ) : (
                <span className="tabular-nums">{row.errors}</span>
              ),
          },
        }}
      />
    </AdminPage>
  );
};

export default AdminMcp;
