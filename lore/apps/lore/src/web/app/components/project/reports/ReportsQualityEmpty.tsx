import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../services/I18n.ts";

export interface ReportsQualityEmptyProps {
  /**
   * The project's slug, so the command the panel prints is the one this
   * reader would actually run.
   */
  projectSlug: string;
}

/**
 * What the Quality tab renders before anything has ever been pushed.
 *
 * ⚠️ Reports has never needed one of these. Overview, Quests and Members are
 * all derived from rows Lore owns, so "empty" there means a project with no
 * quests, which the charts already say. Quality is ingested from a foreign
 * system, so empty is the normal first state and stays that way until someone
 * wires up CI - which makes "here is the command" the only useful thing this
 * screen can say.
 */
const ReportsQualityEmpty = (props: ReportsQualityEmptyProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">
          {tr("reports.quality.empty.title")}
        </h3>
        <p className="text-muted-foreground max-w-prose text-sm">
          {tr("reports.quality.empty.description")}
        </p>
      </div>

      {/*
        The command, verbatim and selectable. A screenshot of a CLI invocation
        is not something anyone can paste into a workflow file.
      */}
      <pre className="bg-muted text-muted-foreground w-full overflow-x-auto rounded-md p-3 text-xs">
        <code>
          {`alepha test --coverage\nalepha lore quality push --project ${props.projectSlug}`}
        </code>
      </pre>

      <p className="text-muted-foreground/70 text-xs">
        {tr("reports.quality.empty.credential")}
      </p>
    </div>
  );
};

export default ReportsQualityEmpty;
