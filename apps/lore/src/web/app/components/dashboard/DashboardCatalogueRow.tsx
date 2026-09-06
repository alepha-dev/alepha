import { useI18n } from "alepha/react/i18n";
import { Check, Plus } from "lucide-react";

import type { DashboardMetricDescriptor } from "@/api/services/DashboardMetricCatalog.ts";

import type { I18n } from "../../services/I18n.ts";
import { dashboardMetricIcon } from "./dashboardMetricIcon.ts";

export interface DashboardCatalogueRowProps {
  metric: DashboardMetricDescriptor;
  /**
   * Whether the board already carries a card on this metric.
   */
  onBoard: boolean;
  /**
   * Why this metric cannot be added right now, if it cannot — an i18n key.
   * A metric with no data available is offered as disabled with the reason
   * rather than hidden, so the reader learns what would make it available.
   */
  unavailableKey?: string;
  onSelect: () => void;
}

/**
 * One metric in the Add-card panel.
 *
 * Everything on the row comes from the registry entry: label, hint, icon,
 * and whether it is on the board already. Adding a metric must require no
 * change here.
 */
const DashboardCatalogueRow = (props: DashboardCatalogueRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const Icon = dashboardMetricIcon(props.metric.icon);
  const State = props.onBoard ? Check : Plus;

  return (
    <button
      type="button"
      onClick={props.onSelect}
      disabled={!!props.unavailableKey}
      data-testid="dashboard-catalogue-row"
      data-metric={props.metric.key}
      className="border-border hover:border-muted-foreground/40 flex items-center gap-2.5 rounded-[9px] border px-2.5 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium">
          {tr(props.metric.labelKey as never)}
        </span>
        <span className="text-muted-foreground mt-px block text-[11.5px]">
          {props.unavailableKey
            ? tr(props.unavailableKey as never)
            : tr(props.metric.hintKey as never)}
        </span>
      </span>
      <State className="text-muted-foreground size-3.5 shrink-0" />
    </button>
  );
};

export default DashboardCatalogueRow;
