import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import ReleasePriorityPill from "./ReleasePriorityPill.tsx";

export interface ReleaseOpenQuestsRailProps {
  quests: QuestResource[];
  questsHref: string;
}

/**
 * Accepted-but-unfinished quests. They are not in the changelog and won't be
 * unless they land before the window closes — so the rail sits beside the
 * changelog rather than inside it, answering "what else is in flight".
 */
const ReleaseOpenQuestsRail = (props: ReleaseOpenQuestsRailProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex flex-col">
      <div className="border-border flex h-12 shrink-0 items-center gap-2 border-b px-5">
        <span className="text-[13.5px] font-semibold">
          {tr("release.ledger.stillOpen")}
        </span>
        <span className="text-muted-foreground text-xs">
          {props.quests.length}
        </span>
        <div className="flex-1" />
        <Link
          href={props.questsHref}
          className="text-muted-foreground hover:text-foreground text-[11.5px] transition-colors"
        >
          {tr("release.ledger.viewInQuests")}
        </Link>
      </div>

      {props.quests.length === 0 ? (
        <p className="text-muted-foreground px-5 py-6 text-center text-xs">
          {tr("release.ledger.stillOpen.empty")}
        </p>
      ) : (
        props.quests.map((quest) => (
          <div key={quest.id} className="border-border/60 border-b px-5 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                #{quest.shortId}
              </span>
              <span className="flex-1 text-[13px]">{quest.title}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 pl-[38px]">
              <span className="font-mono text-[10.5px] font-medium text-green-600 dark:text-green-400">
                {quest.area}
              </span>
              <div className="flex-1" />
              {(quest.priority === "high" || quest.priority === "medium") && (
                <ReleasePriorityPill priority={quest.priority} />
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default ReleaseOpenQuestsRail;
