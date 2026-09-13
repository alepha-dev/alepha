import { Button } from "@alepha/ui/components/ui/button";
import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";
import { ArrowDown, ArrowUp, Download } from "lucide-react";

import { AnalyticsEmpty } from "./AnalyticsEmpty.tsx";
import { analyticsNumber } from "./analyticsModel.ts";
import type { AnalyticsRunResult } from "./analyticsTypes.ts";

export interface ResultsTableProps {
  result: AnalyticsRunResult;
  dataset: string;
  filtered: boolean;
  onSort: (key: string) => void;
}

/**
 * The raw rows.
 *
 * The grid owns both scrollbars and carries a sticky header; the pane around
 * it does not scroll, so there is never a second bar. Dimension columns keep
 * a real width floor and the grid scrolls sideways rather than crushing a
 * path into three characters.
 */
export const ResultsTable = (props: ResultsTableProps) => {
  const { tr } = useI18n();
  const result = props.result;
  const columns = [...result.groupBy, ...result.measures];
  const primary = result.measures[0] ?? "";
  const max = Math.max(
    1,
    ...result.rows.map((row) => Number(row[primary] ?? 0)),
  );

  const downloadCsv = () => {
    const escape = (value: string | number | undefined) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const csv = [
      columns.join(","),
      ...result.rows.map((row) =>
        columns.map((column) => escape(row[column])).join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${props.dataset}-${result.window.from}-${result.window.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-[22px] pb-5">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="text-muted-foreground text-[10.5px] font-semibold tracking-[0.09em] uppercase">
          {tr("admin.analytics.rows", { default: "Rows" })}
        </span>
        <span className="text-muted-foreground text-[11.5px]">
          {/* Dropping every group key leaves exactly one group, so the
              singular is reachable in two clicks and needs its own key. */}
          {result.groupCount === 1
            ? tr("admin.analytics.rowNote.one", {
                default: "1 group · order $1 $2",
                args: [result.orderBy.key, result.orderBy.direction],
              })
            : tr("admin.analytics.rowNote", {
                default: "$1 groups · showing $2 · order $3 $4",
                args: [
                  analyticsNumber(result.groupCount),
                  analyticsNumber(result.rows.length),
                  result.orderBy.key,
                  result.orderBy.direction,
                ],
              })}
        </span>
        <span className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={downloadCsv}>
          <Download className="size-3.5" />
          {tr("admin.analytics.csv", { default: "Download CSV" })}
        </Button>
      </div>
      <div className="ring-border relative min-h-0 flex-1 overflow-auto rounded-xl ring-1 ring-inset">
        <div className="bg-card sticky top-0 z-2 flex min-w-max items-center px-3.5 shadow-[0_1px_0_var(--border)]">
          {columns.map((column) => {
            const measure = result.measures.includes(column);
            const active = result.orderBy.key === column;
            const Arrow =
              result.orderBy.direction === "asc" ? ArrowUp : ArrowDown;
            return (
              <button
                key={column}
                type="button"
                onClick={() => props.onSort(column)}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex h-[34px] items-center gap-1.5 focus-visible:ring-[3px] focus-visible:outline-none",
                  active ? "text-foreground" : "text-muted-foreground",
                  measure
                    ? "w-[132px] flex-none justify-end"
                    : "min-w-40 flex-1 basis-40",
                )}
              >
                <code className="text-[11px] tracking-[0.04em] uppercase">
                  {measure ? `sum(${column})` : column}
                </code>
                {active && <Arrow className="size-[11px]" />}
              </button>
            );
          })}
        </div>
        {result.rows.length === 0 ? (
          <AnalyticsEmpty filtered={props.filtered} />
        ) : (
          <div className="flex flex-col">
            {result.rows.map((row, index) => (
              <div
                // Stringified rather than joined, for the reason
                // `chartModel`'s `groupId` is: a `/` inside a path value would
                // otherwise make two different group tuples one React key.
                key={JSON.stringify(
                  columns.map((column) => String(row[column])),
                )}
                className={cn(
                  "border-border/60 flex min-w-max items-center border-t px-3.5",
                  index % 2 === 1 && "bg-foreground/[.02]",
                )}
              >
                {columns.map((column) => {
                  const measure = result.measures.includes(column);
                  const value = row[column];
                  return (
                    <div
                      key={column}
                      className={cn(
                        "relative flex h-9 items-center",
                        measure
                          ? "w-[132px] flex-none justify-end pl-2.5"
                          : "min-w-40 flex-1 basis-40 pr-2.5",
                      )}
                    >
                      {column === primary && (
                        <span
                          style={{
                            width: `${Math.max(2, Math.round((Number(value ?? 0) / max) * 100))}%`,
                          }}
                          className="bg-primary/25 absolute top-1/2 right-0 h-[18px] -translate-y-1/2 rounded-[3px]"
                        />
                      )}
                      <span
                        className={cn(
                          "relative text-[12.5px]",
                          measure
                            ? "font-mono tabular-nums"
                            : "truncate whitespace-nowrap",
                          (column === "day" || column === "hour") &&
                            "text-muted-foreground",
                        )}
                      >
                        {measure
                          ? analyticsNumber(Number(value ?? 0))
                          : String(value ?? "–")}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
