import { useI18n } from "alepha/react/i18n";
import type { I18n } from "../../services/I18n.ts";

/**
 * The board after the reader has removed every card.
 *
 * ⚠️ This state is only reachable because it is distinguishable from "never
 * seeded". Both are zero rows in `dashboard_cards`; `dashboard_settings`
 * carries the marker that tells them apart. A seeder keyed on "zero rows"
 * would resurrect the defaults here, every time, which is the one thing an
 * empty state must never do.
 *
 * The dashed Add tile stays in the grid above it, so the way back is on
 * screen rather than described.
 */
const DashboardEmpty = () => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div
      data-testid="dashboard-empty"
      className="border-border mt-6 max-w-[560px] rounded-xl border border-dashed p-7"
    >
      <div className="text-sm font-medium">{tr("dashboard.empty.title")}</div>
      <div className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">
        {tr("dashboard.empty.body")}
      </div>
    </div>
  );
};

export default DashboardEmpty;
