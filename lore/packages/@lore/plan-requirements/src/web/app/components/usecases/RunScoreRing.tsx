export interface RunScoreRingProps {
  passed: number;
  total: number;
  /**
   * Whether any criterion failed: the ring is drawn in the danger hue.
   */
  failed: boolean;
  label: string;
}

/**
 * A run's score as a ring (#Q3975): the passed share of its criteria, the
 * figure inside. Green when all passed, red as soon as one failed, neutral
 * otherwise.
 */
const RunScoreRing = (props: RunScoreRingProps) => {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const share = props.total ? props.passed / props.total : 0;
  const tone = props.failed
    ? "text-danger-text"
    : props.total > 0 && props.passed === props.total
      ? "text-success-text"
      : "text-muted-foreground";
  return (
    <span
      className={`relative inline-flex size-11 shrink-0 items-center justify-center ${tone}`}
      role="img"
      aria-label={props.label}
      data-testid="run-score"
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          strokeWidth="4"
          className="stroke-muted"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          strokeWidth="4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
        />
      </svg>
      <span className="text-foreground text-xs font-semibold tabular-nums">
        {props.passed}/{props.total}
      </span>
    </span>
  );
};

export default RunScoreRing;
