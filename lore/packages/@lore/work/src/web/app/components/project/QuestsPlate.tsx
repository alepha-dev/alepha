import { PlateLayout, type PlateTab } from "@alepha/ui/shell";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import { Columns3, List } from "lucide-react";

/**
 * The Quests page's two views, List and Board, as plate tabs over the view:
 * LINKS to two routes, `/quests` and `/quests/board`, keyed by route name.
 *
 * ⚠️ Never a `?view=` switch. That was tried, and its write-back to the URL
 * bounced the reader back to the page on the way out of it (#156). Each tab
 * is a page of its own, so back, copy-link and middle-click all work, and
 * nothing writes to the address bar.
 *
 * The layout page of `projectQuestsLayout`: the plate stays mounted and only
 * the `NestedView` below it swaps, so a tab switch never blanks the page.
 * No plate band: the breadcrumb already says "Quests", so only the tabs.
 */
const QuestsPlate = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter();
  const routerState = useRouterState();
  const params = { projectSlug: routerState.params.projectSlug };
  const tabs: PlateTab[] = [
    {
      key: "projectQuests",
      label: tr("quests.view.list"),
      icon: List,
      href: router.path("projectQuests", { params }),
    },
    {
      key: "projectKanban",
      label: tr("quests.view.board"),
      icon: Columns3,
      href: router.path("projectKanban", { params }),
    },
  ];
  return (
    <PlateLayout
      tabs={tabs}
      // A card opened from the board is `projectQuest`, drawn as a sheet over
      // the board: the Board tab stays the lit one under it.
      active={
        routerState.name === "projectQuest"
          ? "projectKanban"
          : (routerState.name ?? "projectQuests")
      }
      tabsTestId="quests-view-tabs"
      tabsVariant="folder"
      // Both views own their scrolling: the table its rows, the board its
      // columns.
      scroll={false}
    >
      <NestedView />
    </PlateLayout>
  );
};

export default QuestsPlate;
