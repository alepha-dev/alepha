import { z } from "alepha";
import { $tool } from "alepha/mcp";

/**
 * One tool with an MCP Apps view. `sales_report` answers every client in text
 * and JSON; a host that supports `io.modelcontextprotocol/ui` also renders
 * `SalesChart` in an iframe, which calls the tool back for another quarter.
 */
export class SalesTools {
  sales_report = $tool({
    description:
      "Sales per region for a quarter of 2026 (Q1 to Q4), with the total.",
    schema: {
      params: z.object({
        quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).describe("The quarter"),
      }),
      result: z.object({
        quarter: z.text(),
        total: z.number(),
        regions: z.array(z.object({ name: z.text(), amount: z.number() })),
      }),
    },
    ui: { view: () => import("./views/SalesChart.tsx") },
    handler: async ({ params }) => {
      const regions = this.figures[params.quarter].map(([name, amount]) => ({
        name,
        amount,
      }));
      return {
        quarter: params.quarter,
        total: regions.reduce((sum, it) => sum + it.amount, 0),
        regions,
      };
    },
  });

  protected readonly figures: Record<string, Array<[string, number]>> = {
    Q1: [
      ["North", 120],
      ["South", 80],
      ["East", 95],
      ["West", 60],
    ],
    Q2: [
      ["North", 140],
      ["South", 90],
      ["East", 70],
      ["West", 85],
    ],
    Q3: [
      ["North", 100],
      ["South", 130],
      ["East", 110],
      ["West", 75],
    ],
    Q4: [
      ["North", 160],
      ["South", 120],
      ["East", 125],
      ["West", 95],
    ],
  };
}
