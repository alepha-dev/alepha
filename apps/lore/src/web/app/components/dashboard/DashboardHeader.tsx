import { Button } from "@alepha/ui/components/ui/button";
import { DateTimeProvider } from "alepha/datetime";
import { ClientOnly, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plus, RotateCcw } from "lucide-react";
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "../shared/header/HeaderActions.tsx";

export interface DashboardHeaderProps {
  name: string;
  cardCount: number;
  /** Absent until the first resolve returns. */
  refreshedAt?: string;
  onReset: () => void;
  onAdd: () => void;
}

/**
 * The greeting, the standfirst, and the two board-level actions.
 *
 * ⚠️ "refreshed a minute ago" is a **timestamp on the last resolve, not a
 * polling indicator**. Nothing on this page refreshes itself: ten
 * auto-refreshing tiles on the landing page is the exact shape of the
 * QuestGraph incident (folio #1057).
 *
 * Rendered `ClientOnly` because it is relative to now, and this page is
 * server-rendered — a `fromNow()` string differs between the server render
 * and hydration and trips React #418. Home already carries the same note for
 * its project rows.
 *
 * ## Two rows, split by what the controls belong to
 *
 * The top row is app-level and nothing else: the account / theme / language
 * cluster every other surface pins at `top-3`, here flush right so it lands
 * on the same line. The second row is the dashboard's own — the greeting on
 * the left, and the two board actions that only mean anything on this page
 * on the right.
 *
 * All five used to share one baseline, which put the account chrome level
 * with the reader's name and made "Reset layout" read as ambient app chrome
 * rather than something that rewrites this board.
 */
const DashboardHeader = (props: DashboardHeaderProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dateTime = useInject(DateTimeProvider);

  // Two sentences rather than the mockup's one ("10 cards, refreshed a minute
  // ago."). The count is known before the first resolve returns and the
  // timestamp is not, so a single sentence spends the whole loading state
  // reading "4 cards," with a comma and nothing after it.
  const standfirst =
    props.cardCount === 0 ? (
      tr("dashboard.standfirst.empty")
    ) : (
      <>
        {tr(
          props.cardCount === 1
            ? "dashboard.standfirst.one"
            : "dashboard.standfirst",
          { args: [String(props.cardCount)] },
        )}{" "}
        {props.refreshedAt && (
          <ClientOnly>
            {tr("dashboard.refreshed", {
              args: [dateTime.of(props.refreshedAt).fromNow()],
            })}
          </ClientOnly>
        )}
      </>
    );

  return (
    <div className="mb-5">
      <div className="flex items-center justify-end">
        <HeaderActions />
      </div>

      <div className="mt-8 flex items-end gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">
            {tr("dashboard.greeting", { args: [props.name] })}
          </h1>
          <p className="text-muted-foreground mt-[5px] text-[13px]">
            {standfirst}
          </p>
        </div>
        <span className="flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={props.onReset}
            data-testid="dashboard-reset"
            className="h-8 rounded-[9px] px-2.5 text-[12.5px]"
          >
            <RotateCcw className="size-3.5" />
            {tr("dashboard.reset")}
          </Button>
          <Button
            onClick={props.onAdd}
            data-testid="dashboard-add"
            className="h-8 rounded-[9px] px-3 text-[12.5px]"
          >
            <Plus className="size-3.5" />
            {tr("dashboard.addCard")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DashboardHeader;
