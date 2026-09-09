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
 * Centred on both axes and alone on the surface. It used to sit under a
 * dashed Add tile in the grid, which was a second entry point to the panel
 * the header button already opens (feedback #P2168) - and the argument for it,
 * "placed where the reader is already looking when they run out of cards",
 * is exactly what an empty board makes false: what the reader is looking at
 * then is this, and it should say what a board is FOR rather than repeat a
 * button in the corner.
 */
const DashboardEmpty = () => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div
      data-testid="dashboard-empty"
      // Centred on both axes: with the Add tile gone this is the only thing
      // on the surface, and a panel pinned to the top left of an otherwise
      // empty board reads as a leftover rather than as the point.
      className="border-border mx-auto mt-6 flex min-h-[320px] max-w-[560px] flex-col items-center justify-center rounded-xl border border-dashed p-7 text-center"
    >
      <div className="text-sm font-medium">{tr("dashboard.empty.title")}</div>
      <div className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">
        {tr("dashboard.empty.body")}
      </div>
    </div>
  );
};

export default DashboardEmpty;
