import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { PersonaCoverage } from "./personaCoverage.ts";

export interface PersonaRunBarProps {
  coverage?: PersonaCoverage;
}

/**
 * How a persona's use cases last ran, as one bar and its legend (#Q3976):
 * green for passed, red for failed, the track for the rest, then each
 * segment named with its count. Shared by the persona card and the persona
 * page's coverage row, so the two read the same.
 */
const PersonaRunBar = (props: PersonaRunBarProps) => {
  const { tr } = useI18n<I18n, "en">();
  const coverage = props.coverage;
  const total = coverage?.useCases ?? 0;
  const passed = coverage?.passed ?? 0;
  const failed = coverage?.failed ?? 0;
  const notRun = Math.max(0, total - passed - failed);
  const share = (count: number) => (total > 0 ? (count / total) * 100 : 0);
  return (
    <div className="flex flex-col gap-1" data-testid="persona-run-bar">
      <div className="bg-muted flex h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-green-600 dark:bg-green-500"
          style={{ width: `${share(passed)}%` }}
        />
        <div
          className="bg-danger"
          data-segment="failed"
          style={{ width: `${share(failed)}%` }}
        />
      </div>
      <ul
        className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs"
        data-testid="persona-run-legend"
      >
        <li className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-green-600 dark:bg-green-500" />
          {tr("requirements.persona.run.legend.passed", {
            args: [String(passed)],
          })}
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-danger size-2 rounded-full" />
          {tr("requirements.persona.run.legend.failed", {
            args: [String(failed)],
          })}
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-muted size-2 rounded-full border" />
          {tr("requirements.persona.run.legend.notRun", {
            args: [String(notRun)],
          })}
        </li>
      </ul>
    </div>
  );
};

export default PersonaRunBar;
