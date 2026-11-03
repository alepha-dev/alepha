import { Button } from "@alepha/ui";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Download } from "lucide-react";
import type { ReactNode } from "react";

import type { I18n } from "../../../services/I18n.ts";
import {
  ReportsCsv,
  type ReportsCsvRow,
} from "../../../services/ReportsCsv.ts";
import ReportsDefinition from "./ReportsDefinition.tsx";

export interface ReportsSectionProps {
  title: string;
  /**
   * What the section counts and what it divides by, behind an info mark.
   * Required: a report that cannot say what it counts should not be drawn.
   */
  definition: string;
  /**
   * Optional right-aligned control (e.g. a range select).
   */
  action?: ReactNode;
  /**
   * The data behind the section. When given and not empty, the header offers
   * it as a CSV.
   */
  csv?: { filename: string; rows: ReportsCsvRow[] };
  children: ReactNode;
}

/**
 * Flat dashboard section — a heading + body separated from the next section
 * by a bottom border. The Reports redesign replaces `<Card>` walls with
 * these.
 */
const ReportsSection = (props: ReportsSectionProps) => {
  const { tr } = useI18n<I18n, "en">();
  const csv = useInject(ReportsCsv);

  return (
    <section className="border-border flex flex-col gap-3 border-b pb-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-muted-foreground text-sm font-semibold">
            {props.title}
          </h3>
          <ReportsDefinition text={props.definition} />
        </div>
        <div className="flex items-center gap-2">
          {props.action}
          {props.csv && props.csv.rows.length > 0 ? (
            <Button
              type="button"
              variant="minimal"
              size="xs"
              onClick={() =>
                csv.download(props.csv?.filename ?? "", props.csv?.rows ?? [])
              }
            >
              <Download className="size-3" />
              {tr("reports.csv")}
            </Button>
          ) : null}
        </div>
      </div>
      {props.children}
    </section>
  );
};

export default ReportsSection;
