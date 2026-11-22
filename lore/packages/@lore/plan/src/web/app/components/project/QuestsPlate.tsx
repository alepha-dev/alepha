import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import type { I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView } from "alepha/react/router";
import { Columns3, List } from "lucide-react";

import { questsViewAtom } from "../../atoms/questsViewAtom.ts";

/**
 * The Quests page's two views, List and Board, as plate tabs over the body.
 *
 * Both are `/quests`: a tab swaps the body in place and remembers the choice
 * in `questsViewAtom`, a cookie, so the page reopens on the view last used.
 * The board was a route of its own (`/quests/board`) before.
 *
 * ⚠️ Never a `?view=` switch. Its write-back to the URL bounced the reader
 * back to the page on the way out of it (#156). The cookie is written by a
 * click only.
 *
 * The layout page of `projectQuestsLayout`: the plate stays mounted and only
 * the body below it swaps, so a tab switch never blanks the page. No plate
 * band: the breadcrumb already says "Quests", so only the tabs.
 */
const QuestsPlate = () => {
  const { tr } = useI18n<I18n, "en">();
  const [{ view }, setView] = useStore(questsViewAtom);
  const tabs: PlateTab[] = [
    { key: "list", label: tr("quests.view.list"), icon: List },
    { key: "board", label: tr("quests.view.board"), icon: Columns3 },
  ];
  return (
    <PlateLayout
      tabs={tabs}
      active={view}
      onSelect={(key) => setView({ view: key === "board" ? "board" : "list" })}
      tabsTestId="quests-view-tabs"
      // Both views own their scrolling: the table its rows, the board its
      // columns.
      scroll={false}
    >
      <NestedView />
    </PlateLayout>
  );
};

export default QuestsPlate;
