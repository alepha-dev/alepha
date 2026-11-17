import { Button } from "@alepha/ui";
import { currentProjectAtom, formatReference, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Printer } from "lucide-react";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import { formatMetricValue, metricLine } from "../requirements/metricText.ts";
import {
  REQUIREMENT_PRIORITY_LABEL_KEYS,
  REQUIREMENT_STATUS_LABEL_KEYS,
} from "../requirements/requirementLabels.ts";

const RESULT_KEYS = {
  passed: "requirements.run.result.passed",
  failed: "requirements.run.result.failed",
  not_run: "requirements.run.result.not_run",
} as const;

/**
 * The test book (#E153, #Q3774): every requirement per chapter, with the
 * criteria verifying it and their last results, styled for print. The
 * reader saves it as PDF from the browser's print dialog: Lore has no PDF
 * library and adds none.
 */
const TestBookPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  const projectId = project?.id ?? 0;
  const list = useQuery<RequirementResource[]>(
    {
      key: ["requirements", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await api.getRequirements({ params: { projectId }, query: {} }),
    },
    [api, projectId],
  );
  if (!project) return null;
  const chapters = new Map<string, RequirementResource[]>();
  for (const row of list.data ?? []) {
    const key = row.chapter ?? "";
    chapters.set(key, [...(chapters.get(key) ?? []), row]);
  }

  return (
    <div
      className="mx-auto flex max-w-4xl flex-col gap-6 p-8 print:max-w-none print:p-0"
      data-testid="test-book"
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {tr("requirements.trace.testBook.title", { args: [project.title] })}
          </h1>
        </div>
        <Button className="print:hidden" onClick={() => window.print()}>
          <Printer className="size-4" />
          {tr("requirements.trace.testBook.print")}
        </Button>
      </header>
      {[...chapters].map(([chapter, rows]) => (
        <section
          key={chapter}
          className="flex break-inside-avoid flex-col gap-3"
        >
          <h2 className="border-b pb-1 text-lg font-semibold">
            {chapter || tr("requirements.requirement.noChapter")}
          </h2>
          {rows.map((it) => (
            <article
              key={it.id}
              className="flex break-inside-avoid flex-col gap-1 text-sm"
            >
              <div className="flex justify-between gap-4">
                <span>
                  <span className="font-semibold">
                    {formatReference("requirement", it.number)}
                  </span>{" "}
                  {it.paragraph ? `§${it.paragraph} ` : ""}
                  {it.statement}
                </span>
                <span className="shrink-0 text-xs">
                  {tr(REQUIREMENT_PRIORITY_LABEL_KEYS[it.priority])} ·{" "}
                  {tr(REQUIREMENT_STATUS_LABEL_KEYS[it.status])}
                </span>
              </div>
              {it.metric ? (
                <p className="text-muted-foreground font-mono text-xs">
                  {metricLine(it.metric)}
                  {it.metricValue !== undefined
                    ? ` = ${formatMetricValue(it.metric, it.metricValue)}`
                    : ""}
                </p>
              ) : (
                <ul className="text-muted-foreground pl-4 text-xs">
                  {it.criteria.map((c) => (
                    <li key={`${c.useCaseNumber}:${c.key}`}>
                      {formatReference("usecase", c.useCaseNumber)} {c.key}{" "}
                      {c.summary}: {tr(RESULT_KEYS[c.result ?? "not_run"])}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
};

export default TestBookPage;
