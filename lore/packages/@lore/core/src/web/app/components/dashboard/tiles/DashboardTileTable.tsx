import { useRouter } from "alepha/react/router";

import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";

export interface DashboardTileTableProps {
  value: DashboardCardValue;
}

/**
 * A few columns of a few rows (#E144, #Q3520): `detail.columns` names the
 * columns and `detail.cells[i]` holds row `i`'s texts; `rows[i].link`, when
 * present, makes the row open what it shows. Text only, truncated: a card
 * is a glance, the folio is one click away.
 */
const DashboardTileTable = (props: DashboardTileTableProps) => {
  // Route names come from the resolver, which may be any module's.
  const router = useRouter<any>();
  const columns = Array.isArray(props.value.detail.columns)
    ? (props.value.detail.columns as string[])
    : [];
  const cells = Array.isArray(props.value.detail.cells)
    ? (props.value.detail.cells as string[][])
    : [];
  const rows = props.value.rows ?? [];

  return (
    <div className="w-full min-w-0 overflow-hidden" data-testid="tile-table">
      <table className="w-full table-fixed border-collapse text-[12px]">
        <thead>
          <tr className="text-muted-foreground text-[10.5px]">
            {columns.map((column) => (
              <th
                key={column}
                className="truncate pe-2 pb-1 text-start font-medium"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((line, index) => {
            const link = rows[index]?.link;
            return (
              <tr
                key={rows[index]?.id ?? String(index)}
                className={
                  link
                    ? "hover:bg-hover border-border cursor-pointer border-t"
                    : "border-border border-t"
                }
                onClick={
                  link
                    ? () =>
                        void router.push(
                          router.path(link.route, {
                            params: link.params,
                            query: link.query,
                          }),
                        )
                    : undefined
                }
              >
                {columns.map((column, c) => (
                  <td key={column} className="truncate py-[3px] pe-2">
                    {line[c] ?? ""}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default DashboardTileTable;
