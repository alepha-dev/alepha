export interface ReportsHeatmapProps {
  /**
   * Rows top to bottom (weekdays), with `cells` left to right (hours).
   */
  rows: Array<{ label: string; cells: number[] }>;
  columns: string[];
  /**
   * The cell's text for a screen reader and the hover tooltip.
   */
  describe: (row: string, column: string, value: number) => string;
}

/**
 * A weekday x hour grid (#Q2997): one hue from pale to full, so a reader sees
 * magnitude and never a category. Empty cells stay on the surface.
 */
const ReportsHeatmap = (props: ReportsHeatmapProps) => {
  const max = Math.max(1, ...props.rows.flatMap((row) => row.cells));

  return (
    <div
      className="grid items-center gap-0.5 overflow-x-auto text-[10px]"
      style={{
        gridTemplateColumns: `max-content repeat(${props.columns.length}, minmax(10px, 1fr))`,
      }}
      data-testid="reports-heatmap"
    >
      <span />
      {props.columns.map((column) => (
        <span
          key={column}
          className="text-muted-foreground text-center tabular-nums"
        >
          {column}
        </span>
      ))}
      {props.rows.map((row) => (
        <div key={row.label} className="contents">
          <span className="text-muted-foreground pr-2">{row.label}</span>
          {row.cells.map((value, index) => {
            const text = props.describe(
              row.label,
              props.columns[index] ?? "",
              value,
            );
            return (
              <span
                key={props.columns[index]}
                title={text}
                role="img"
                aria-label={text}
                className="bg-muted h-4 rounded-sm"
                style={
                  value > 0
                    ? {
                        backgroundColor: "var(--chart-1)",
                        opacity: 0.2 + 0.8 * (value / max),
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default ReportsHeatmap;
