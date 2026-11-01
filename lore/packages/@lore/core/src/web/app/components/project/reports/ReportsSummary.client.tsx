import { Button, useToast } from "@alepha/ui";
import type { Infer } from "alepha";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Copy } from "lucide-react";

import type {
  ReportsSummaryLine,
  reportsSummarySchema,
} from "../../../../../api/schemas/reportsSummarySchema.ts";
import type { ReportsUrl } from "../../../../../api/schemas/reportsUrlSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { ReportsSummaryMarkdown } from "../../../services/ReportsSummaryMarkdown.ts";
import { AgentPromptsMenu } from "../prompts/AgentPromptsMenu.tsx";
import { useAgentPromptSubject } from "../prompts/useAgentPromptSubject.ts";
import ReportsKpiRow from "./ReportsKpiRow.tsx";
import ReportsSection from "./ReportsSection.tsx";

export interface ReportsSummaryProps {
  summary: Infer<typeof reportsSummarySchema>;
  /**
   * The bar's page query: a line's link keeps the same filters.
   */
  url: ReportsUrl;
  /**
   * The routes of the tabs this project has.
   */
  tabs: string[];
}

/**
 * Reports "Summary" tab (#Q2999): each enabled capability's period against the
 * previous one, and a link into the tab that explains it.
 */
const ReportsSummary = (props: ReportsSummaryProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const toast = useToast();
  const [project] = useStore(currentProjectAtom);
  const markdown = useInject(ReportsSummaryMarkdown);
  const promptSubject = useAgentPromptSubject();

  const format = (line: ReportsSummaryLine, value: number) => {
    if (line.format === "percent") {
      return `${Math.round(value * 10) / 10}%`;
    }
    if (line.format === "hours") {
      return value >= 48
        ? `${Math.round(value / 24)}d`
        : `${Math.round(value)}h`;
    }
    return String(Math.round(value));
  };
  const label = (key: string) => tr(`reports.summary.line.${key}` as never);

  const copy = async () => {
    await navigator.clipboard.writeText(
      markdown.render(project?.title ?? "", props.summary.lines, {
        line: label,
        format,
      }),
    );
    toast.success(tr("reports.summary.copied"));
  };

  const sections = [...new Set(props.summary.lines.map((it) => it.capability))];

  if (props.summary.lines.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        {tr("reports.summary.empty")}
      </p>
    );
  }

  return (
    <>
      <div className="flex justify-end gap-2">
        <AgentPromptsMenu
          items={[
            {
              kind: "weeklyStatus" as const,
              subject: () => promptSubject.forPage("reportsSummary"),
            },
          ]}
        />
        <Button type="button" variant="outlined" size="sm" onClick={copy}>
          <Copy className="size-3.5" />
          {tr("reports.summary.copy")}
        </Button>
      </div>
      {sections.map((capability) => (
        <ReportsSection
          key={capability}
          title={tr(`reports.summary.section.${capability}` as never)}
          definition={tr("reports.summary.definition")}
        >
          <ReportsKpiRow
            kpis={props.summary.lines
              .filter((line) => line.capability === capability)
              .map((line) => ({
                label: label(line.key),
                definition: tr(
                  `reports.summary.line.${line.key}.definition` as never,
                ),
                value: format(line, line.value),
                href:
                  line.tab && props.tabs.includes(line.tab)
                    ? router.path(
                        line.tab as never,
                        { query: props.url } as never,
                      )
                    : undefined,
                delta:
                  line.previous === undefined
                    ? undefined
                    : {
                        current: line.value,
                        previous: line.previous,
                        upIsGood: line.upIsGood,
                        format: (difference: number) =>
                          format(line, difference),
                      },
              }))}
          />
        </ReportsSection>
      ))}
    </>
  );
};

export default ReportsSummary;
