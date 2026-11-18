import type { PersonaCoverage } from "./personaCoverage.ts";

export interface PersonaRunBarProps {
  coverage?: PersonaCoverage;
}

/**
 * How a persona's use cases last ran, as one bar: green for passed, orange
 * for failed, the track for the rest. Shared by the persona card and the
 * persona page's coverage row, so the two read the same.
 */
const PersonaRunBar = (props: PersonaRunBarProps) => {
  const coverage = props.coverage;
  const total = coverage?.useCases ?? 0;
  const share = (count: number) => (total > 0 ? (count / total) * 100 : 0);
  return (
    <div className="bg-muted flex h-1.5 overflow-hidden rounded-full">
      <div
        className="bg-green-600 dark:bg-green-500"
        style={{ width: `${share(coverage?.passed ?? 0)}%` }}
      />
      <div
        className="bg-orange-500"
        style={{ width: `${share(coverage?.failed ?? 0)}%` }}
      />
    </div>
  );
};

export default PersonaRunBar;
