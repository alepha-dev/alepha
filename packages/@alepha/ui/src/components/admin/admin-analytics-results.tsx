import * as React from "react";

void React;

import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@alepha/ui/components/ui/table";
import type {
  AdminAnalyticsResult,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";
import { useI18n } from "alepha/react/i18n";

export interface AdminAnalyticsResultsProps {
  dataset: AdminDatasetDescriptor;
  result: AdminAnalyticsResult;
}

/**
 * Aggregate rows as a plain table, with the sampling-honesty badge the
 * result schema carries: `estimated` with `sampleInterval > 1` means the
 * numbers are reconstructed; `estimated` with an interval of 1 means the
 * backend samples but did not in this window.
 */
export function AdminAnalyticsResults(props: AdminAnalyticsResultsProps) {
  const { tr } = useI18n();
  const columns = Object.keys(props.result.rows[0] ?? {});
  const sampleInterval = props.result.sampleInterval ?? 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">
          {tr("admin.analytics.rowCount", {
            default: "$1 rows",
            args: [String(props.result.rows.length)],
          })}
        </span>
        {props.result.estimated && sampleInterval > 1 && (
          <Badge variant="outline">
            {tr("admin.analytics.estimated", {
              default: "Estimated (sampled ×$1)",
              args: [String(sampleInterval)],
            })}
          </Badge>
        )}
        {props.result.estimated && sampleInterval <= 1 && (
          <Badge variant="outline">
            {tr("admin.analytics.exactSample", {
              default: "Exact (no sampling in window)",
            })}
          </Badge>
        )}
      </div>
      {props.result.rows.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {tr("admin.analytics.empty", {
            default: "No data for this query.",
          })}
        </div>
      ) : (
        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.result.rows.map((row, index) => (
                <TableRow key={`${index}-${String(row[columns[0]] ?? "")}`}>
                  {columns.map((column) => (
                    <TableCell key={column} className="tabular-nums">
                      {String(row[column] ?? "—")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default AdminAnalyticsResults;
