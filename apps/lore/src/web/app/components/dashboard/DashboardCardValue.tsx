import { Skeleton } from "@alepha/ui/components/ui/skeleton";
import { useI18n } from "alepha/react/i18n";

import type { DashboardCardValue as CardValue } from "@/api/schemas/dashboardCardValueSchema.ts";
import type { DashboardPresentation } from "@/api/services/DashboardMetricCatalog.ts";

import type { I18n } from "../../services/I18n.ts";
import { DASHBOARD_NO_VALUE } from "./dashboardChips.ts";

export interface DashboardCardValueProps {
  /**
   * Absent until the first resolve returns.
   */
  value?: CardValue;
  /**
   * How the metric renders its figure, from the catalogue.
   *
   * Only `progress` changes anything here, and it has to: its number IS a
   * percentage, so rendering it bare would put "62" where the reader reads a
   * count of things.
   */
  presentation?: DashboardPresentation;
}

/**
 * The big number.
 *
 * Three states, all designed rather than discovered: not resolved yet (a
 * skeleton the size of the numeral it will become, so nothing jumps), failed
 * (a short line saying so, never a zero), and resolved.
 *
 * ⚠️ A resolved card with no number is NOT a zero. An app that reports no
 * page views and an app nobody visited are different facts, and only one of
 * them is about traffic.
 */
const DashboardCardValue = (props: DashboardCardValueProps) => {
  const { tr, l } = useI18n<I18n, "en">();

  if (!props.value) {
    return <Skeleton className="mt-0.5 h-8 w-20" />;
  }

  if (!props.value.ok) {
    return (
      <div className="text-muted-foreground mt-0.5 text-sm">
        {tr("dashboard.card.failed")}
      </div>
    );
  }

  // ⚠️ Absent is NOT zero, and on a progress card it is the divide-by-zero
  // case: an epic with no quests, or one whose every quest is shelved, has no
  // honest percentage. The glyph says so; `0%` would claim none of it is done.
  if (props.value.value === undefined) {
    return (
      <div className="mt-0.5 text-[32px] leading-none font-semibold tracking-[-0.025em] tabular-nums">
        {DASHBOARD_NO_VALUE}
      </div>
    );
  }

  return (
    <div className="mt-0.5 text-[32px] leading-none font-semibold tracking-[-0.025em] tabular-nums">
      {String(l(props.value.value))}
      {props.presentation === "progress" && (
        <span className="text-muted-foreground text-[20px]">%</span>
      )}
    </div>
  );
};

export default DashboardCardValue;
