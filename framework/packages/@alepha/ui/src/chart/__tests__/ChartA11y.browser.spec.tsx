import { cleanup, render } from "@testing-library/react";
import { expectAccessible, setupJsdomMocks } from "alepha/testing/react";
import { Bar, BarChart, XAxis } from "recharts";
import { afterEach, beforeAll, describe, it } from "vitest";

import { type ChartConfig, ChartContainer } from "../Chart.tsx";

const config = {
  visits: { label: "Visits", color: "var(--chart-1)" },
} satisfies ChartConfig;

/**
 * axe on the chart wrapper, under jsdom (#Q3338): its container and the SVG
 * recharts draws inside it. Structure only; the colours are the showcase's.
 */
describe("ChartContainer passes axe", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("a bar chart with its axis", async () => {
    render(
      <main>
        <ChartContainer
          config={config}
          role="figure"
          aria-label="Visits per month"
        >
          <BarChart
            data={[
              { month: "Jan", visits: 12 },
              { month: "Feb", visits: 30 },
            ]}
          >
            <XAxis dataKey="month" />
            <Bar dataKey="visits" fill="var(--color-visits)" />
          </BarChart>
        </ChartContainer>
      </main>,
    );
    await expectAccessible();
  });
});
