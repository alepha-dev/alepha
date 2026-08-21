import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";
import type { I18n } from "../../services/I18n.ts";

export interface DashboardAddTileProps {
  onClick: () => void;
}

/**
 * The dashed tile at the end of the grid.
 *
 * A second entry point to the same panel the header's "Add card" opens,
 * placed where the reader is already looking when they run out of cards.
 *
 * ⚠️ The mockup's copy for this carries an em dash. This repo does not use
 * them anywhere, so the locale reworks the sentence rather than transcribing
 * it.
 */
const DashboardAddTile = (props: DashboardAddTileProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <button
      type="button"
      onClick={props.onClick}
      data-testid="dashboard-add-tile"
      className="border-border hover:border-muted-foreground/50 flex h-full cursor-pointer flex-col items-start justify-center gap-2 rounded-xl border border-dashed p-3.5 text-left transition-colors"
    >
      <Plus className="text-muted-foreground size-[18px]" />
      <span className="text-[13px] font-medium">{tr("dashboard.addCard")}</span>
      <span className="text-muted-foreground text-[11.5px] leading-relaxed">
        {tr("dashboard.addCard.hint")}
      </span>
    </button>
  );
};

export default DashboardAddTile;
