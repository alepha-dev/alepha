import { Badge } from "@alepha/ui";
import { AdminPage } from "@alepha/ui/admin";
import { DataTable } from "@alepha/ui/table";
import { useClient, useQuery } from "alepha/react";

import type { AdminMcpController } from "@/api/controllers/AdminMcpController.ts";

import { AdminMcpCallsChart } from "./AdminMcpCallsChart.client.tsx";

type McpToolRow = Awaited<
  ReturnType<AdminMcpController["readMcpCalls"]>
>["leaderboard"][number];

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
 * Literal English, like every other page in the Lore admin: this shell is
 * untranslated.
 */
export const AdminMcp = () => {
  const client = useClient<AdminMcpController>();

  const { data, loading } = useQuery(
    {
      key: ["admin-mcp-calls"],
      handler: () => client.readMcpCalls(),
    },
    [client],
  );

  return (
    <AdminPage>
      <DataTable<McpToolRow>
        className="min-h-0 flex-1"
        data={data?.leaderboard ?? []}
        rowKey={(row) => row.tool}
        persistenceKey="admin.mcp"
        defaultSort={{ field: "total", direction: "desc" }}
        summary={{
          title: "Calls, last 30 days",
          content: <AdminMcpCallsChart data={data} loading={loading} />,
        }}
        emptyState={{
          title: loading ? "Reading…" : "No tool has been called yet.",
        }}
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
