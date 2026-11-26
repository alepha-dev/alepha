import "./SalesChart.css";
import { Button } from "@alepha/ui";
import { useMcpApp } from "alepha/mcp/view";
import { useState } from "react";

interface SalesReport {
  quarter: string;
  total: number;
  regions: Array<{ name: string; amount: number }>;
}

/**
 * The view of `sales_report`: a bar per region, and a button per quarter
 * that calls the tool back through the host.
 */
const SalesChart = () => {
  const app = useMcpApp();
  const [override, setOverride] = useState<SalesReport>();
  const [loading, setLoading] = useState(false);
  const report =
    override ?? (app.result?.structuredContent as SalesReport | undefined);
  const max = Math.max(1, ...(report?.regions ?? []).map((it) => it.amount));

  const load = async (quarter: string) => {
    setLoading(true);
    try {
      const result = await app.callTool("sales_report", { quarter });
      setOverride(result.structuredContent as unknown as SalesReport);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card text-foreground flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">
          Sales {report ? `· ${report.quarter} 2026` : ""}
        </h1>
        <span className="text-muted-foreground text-sm" data-testid="total">
          {report ? `Total ${report.total}` : "Waiting for the result"}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {(report?.regions ?? []).map((region) => (
          <li key={region.name} className="flex items-center gap-2 text-sm">
            <span className="w-12">{region.name}</span>
            <span
              className="bg-primary h-4 rounded"
              style={{ width: `${(region.amount / max) * 70}%` }}
            />
            <span className="text-muted-foreground">{region.amount}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {["Q1", "Q2", "Q3", "Q4"].map((quarter) => (
          <Button
            key={quarter}
            size="sm"
            intent={report?.quarter === quarter ? "primary" : "none"}
            variant={report?.quarter === quarter ? "solid" : "outlined"}
            disabled={loading}
            onClick={() => load(quarter)}
          >
            {quarter}
          </Button>
        ))}
      </div>
    </div>
  );
};

export default SalesChart;
