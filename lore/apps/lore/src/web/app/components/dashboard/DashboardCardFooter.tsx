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
  const { tr, l } = useI18n<I18n, "en">();

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

  // ⚠️ Widened from `number | boolean` when `epicProgress` arrived: it puts an
  // epic's status and its conclusion date in the bag, both strings. Kept as a
  // union of the primitives the metrics actually write rather than `unknown`,
  // because `String(unknown)` is what `no-base-to-string` refuses - and it is
  // right to, since a bag that could hold an object would stringify one as
  // `[object Object]` in the middle of a sentence.
  const detail = props.value.detail as Record<
    string,
    number | boolean | string | null | undefined
  >;
  const line = (() => {
    if (props.metric === "activeQuests") {
      return tr("dashboard.footer.questSplit", {
        args: [String(detail.acceptedCount ?? 0), String(detail.newCount ?? 0)],
      });
    }
    if (props.metric === "epicProgress") {
      // ⚠️ Status-dependent, reusing the Epics list's own readings rather
      // than inventing prose: a `planned` epic reports what is SPECIFIED and
      // that none of it is released, a `done` one reports when it concluded,
      // and only an `active` one gets the buckets. See `ProjectEpicsProgress`.
      if (detail.hidden) return tr("dashboard.footer.epic.hidden");
      const denominator = Number(detail.denominator ?? 0);
      if (denominator === 0) return tr("dashboard.footer.epic.nothing");
      if (detail.status === "done") {
        return detail.completedAt
          ? tr("dashboard.footer.epic.concluded", {
              args: [String(l(String(detail.completedAt), { date: "ll" }))],
            })
          : tr("dashboard.footer.epic.concludedUndated");
      }
      if (detail.status === "planned") {
        return tr("dashboard.footer.epic.specified", {
          args: [String(detail.total ?? 0)],
        });
      }
      // ⚠️ Says the DENOMINATOR, not just the ratio. The Epics list draws its
      // tick bar over `total`, shelved included, so a reader comparing the
      // two finds numbers that do not match and has to be told which is
      // which. The docs page says it again.
      return tr("dashboard.footer.epic.done", {
        args: [String(detail.completed ?? 0), String(denominator)],
      });
    }
    if (props.metric === "heldQuests") {
      // Says what the number is made OF, which for this card means the
      // denominator it is a subset of: the same open count the Active Quests
      // card shows, from the same `OpenQuestScope`. "3 of 12 open" is what
      // makes the containment checkable rather than asserted.
      const open = Number(detail.open ?? 0);
      if (props.value?.value === 0) return tr("dashboard.footer.held.none");
      return tr(
        open === 1 ? "dashboard.footer.held.one" : "dashboard.footer.held",
        { args: [String(open)] },
      );
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
