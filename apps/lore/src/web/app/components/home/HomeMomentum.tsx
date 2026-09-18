export interface HomeMomentumProps {
  /**
   * One count per day, oldest first, as `getHomeBoard` returns them.
   */
  counts: number[];
  /**
   * The day labels the counts are indexed by, for the tooltip.
   */
  days: string[];
  /**
   * The tallest bar across EVERY row of the table, so the column compares
   * projects rather than each project against itself.
   */
  ceiling: number;
  /**
   * Accessible summary of the whole series, e.g. "312 events over 14 days".
   * The bars themselves are decoration and carry no text.
   */
  label: string;
}

/**
 * Fourteen days of a project's recorded writes, one bar per day.
 *
 * ## The scale is shared, and that is the whole point
 *
 * Every row is drawn against the tallest bar in the table, not its own. A
 * per-row scale would give a project with two events a week the same silhouette
 * as one with two hundred, which reads as "equally busy" at a glance and is the
 * opposite of what the column is for. The cost is that quiet projects are
 * nearly flat, which is the true answer.
 *
 * ## A floor under a non-zero day
 *
 * A day with events is never invisible: anything above zero draws at least a
 * sliver. Without it, one event beside a 500-event day rounds to nothing and a
 * reader cannot tell it from a day when nobody touched the project, which are
 * different facts.
 */
export const HomeMomentum = (props: HomeMomentumProps) => {
  const ceiling = Math.max(props.ceiling, 1);

  return (
    <div
      className="flex h-7 items-end gap-[2px]"
      role="img"
      aria-label={props.label}
    >
      {props.counts.map((count, index) => {
        const ratio = count / ceiling;
        return (
          <div
            key={props.days[index] ?? index}
            title={`${props.days[index] ?? ""} · ${count}`}
            className={
              count > 0
                ? "bg-primary/80 w-1.5 rounded-[1px]"
                : "bg-muted-foreground/25 w-1.5 rounded-[1px]"
            }
            style={{
              // A percentage of the row's own height, so the column keeps its
              // shape whatever the table's row height is.
              height: count > 0 ? `${Math.max(ratio * 100, 8)}%` : "6%",
            }}
          />
        );
      })}
    </div>
  );
};
