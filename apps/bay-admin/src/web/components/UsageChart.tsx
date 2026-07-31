export interface UsageChartProps {
  /**
   * One value per sample, oldest first. `undefined` marks a sample where the
   * supervisor had nothing to report — a stopped app, a Bay that was
   * restarting — and is drawn as a gap rather than as zero.
   */
  values: Array<number | undefined>;
  /** Formats a value for the axis labels. */
  format: (value: number) => string;
  label: string;
}

/**
 * A plain inline chart.
 *
 * A charting library for one line would be the largest dependency in this app,
 * and the shape around an incident is all anyone reads here.
 */
const UsageChart = (props: UsageChartProps) => {
  const present = props.values.filter(
    (value): value is number => value !== undefined,
  );
  if (present.length < 2) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Not enough samples yet — one is taken every minute.
      </p>
    );
  }

  const max = Math.max(...present);
  const min = Math.min(...present);
  // A flat line sits in the middle rather than on the floor: an app holding a
  // steady 80 MB drawn along the bottom axis reads as an app using nothing.
  const span = max - min || Math.max(max, 1);
  const floor = max === min ? min - span / 2 : min;

  const x = (index: number) =>
    (index / Math.max(props.values.length - 1, 1)) * 100;
  const y = (value: number) => 40 - ((value - floor) / span) * 40;

  // Built as separate segments so a gap stays a gap. Joining across an absent
  // sample would draw a straight line through a period when the app was down,
  // which is the one moment somebody is looking at this chart for.
  const segments: string[] = [];
  let current: string[] = [];
  props.values.forEach((value, index) => {
    if (value === undefined) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(
      `${current.length === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`,
    );
  });
  if (current.length > 1) segments.push(current.join(" "));

  return (
    <div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="text-primary h-32 w-full"
        role="img"
        aria-label={props.label}
      >
        <title>{props.label}</title>
        {segments.map((path) => (
          <path
            key={path.slice(0, 24)}
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="text-muted-foreground mt-1 flex justify-between text-xs tabular-nums">
        <span>{props.format(min)}</span>
        <span>peak {props.format(max)}</span>
      </div>
    </div>
  );
};

export default UsageChart;
