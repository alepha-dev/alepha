import { Skeleton } from "@alepha/ui/components/ui/skeleton";
import { useI18n } from "alepha/react/i18n";

import type { DashboardCardValue } from "@/api/schemas/dashboardCardValueSchema.ts";

import type { I18n } from "../../services/I18n.ts";

export interface DashboardCardFooterProps {
  metric: string;
  value?: DashboardCardValue;
}

/**
 * The line under the number.
 *
 * The resolver returns numbers and keys; every word here comes from the
 * locale. That split is why `detail` is a record: its keys are per metric,
 * documented on `dashboardCardValueSchema`, and read only here.
 *
 * The footers are not decoration. "oldest waiting 30 days" is the more
 * actionable half of a feedback count, and "312 occurrences" is what stops a
 * blight count of 4 reading as calm.
 */
const DashboardCardFooter = (props: DashboardCardFooterProps) => {
  const { tr } = useI18n<I18n, "en">();

  if (!props.value) {
    return <Skeleton className="h-3.5 w-32" />;
  }

  if (!props.value.ok) {
    return (
      <div className="text-muted-foreground text-xs">
        {tr("dashboard.card.failed.hint")}
      </div>
    );
  }

  const detail = props.value.detail as Record<string, number | boolean>;
  const line = (() => {
    if (props.metric === "activeQuests") {
      return tr("dashboard.footer.questSplit", {
        args: [String(detail.acceptedCount ?? 0), String(detail.newCount ?? 0)],
      });
    }
    if (props.metric === "openBlights") {
      const apps = Number(detail.apps ?? 0);
      return tr(
        apps === 1
          ? "dashboard.footer.blights.one"
          : "dashboard.footer.blights",
        { args: [String(detail.occurrences ?? 0), String(apps)] },
      );
    }
    if (props.metric === "untriagedFeedback") {
      if (props.value?.value === 0) return tr("dashboard.footer.feedback.none");
      const days = Number(detail.oldestWaitingDays ?? 0);
      if (days === 0) return tr("dashboard.footer.feedback.today");
      return tr(
        days === 1
          ? "dashboard.footer.feedback.oneDay"
          : "dashboard.footer.feedback.days",
        { args: [String(days)] },
      );
    }
    if (props.metric === "uniqueVisitors") {
      if (detail.noBeaconApp) return tr("dashboard.footer.noBeacon");
      const delta = props.value?.delta;
      // Absent is not zero: the previous day was empty, so there is no
      // honest percentage to show and the card says so rather than
      // inventing `+100%`.
      if (delta === undefined) return tr("dashboard.footer.visitors.noCompare");
      if (delta === 0) return tr("dashboard.footer.visitors.flat");
      return tr("dashboard.footer.visitors.delta", {
        args: [`${delta > 0 ? "+" : ""}${delta}`],
      });
    }
    return "";
  })();

  return <div className="text-muted-foreground text-xs">{line}</div>;
};

export default DashboardCardFooter;
