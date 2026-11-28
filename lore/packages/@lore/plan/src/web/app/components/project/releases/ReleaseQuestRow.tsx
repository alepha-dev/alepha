import { Badge, cn } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";

import type { ReleaseContentQuest } from "../../../../../api/schemas/releaseContentQuestSchema.ts";
import {
  QUEST_STATUS_ICON,
  QUEST_STATUS_LABEL_KEYS,
  QUEST_STATUS_TONE,
} from "../quest/questChips.ts";
import {
  BUCKET_ICON_CLASS,
  BUCKET_ICONS,
  questBucket,
  questStatus,
} from "./releaseBuckets.ts";
import ReleasePriorityPill from "./ReleasePriorityPill.tsx";

export interface ReleaseQuestRowProps {
  quest: ReleaseContentQuest;
}

/**
 * One quest inside the Contents tab, under an epic card or an area group.
 *
 * A `Link` rather than a clickable div, so cmd-click opens the quest in a tab
 * the way every other quest reference in Lore does.
 *
 * The title carries the row's state as well as the glyph does: a completed
 * quest fades, because it is settled and the reader is scanning for what is
 * not; a shelved one is struck through, because it is not going to happen and
 * fading alone would read as "done" at a glance.
 *
 * A draft sits in the open bucket with its glyph (#E178 review, item 11),
 * and wears the Draft chip the Quests table gives it, so the reader sees
 * that nobody can take it yet without the ratio counting it apart.
 */
const ReleaseQuestRow = (props: ReleaseQuestRowProps) => {
  const { quest } = props;
  const router = useRouter();
  const { tr } = useI18n<I18n, "en">();
  const bucket = questBucket(quest);
  const Icon = BUCKET_ICONS[bucket];
  const draft = questStatus(quest) === "draft";
  const DraftIcon = QUEST_STATUS_ICON.draft;

  return (
    <Link
      href={router.path("projectQuest", {
        params: {
          projectSlug: router.state.params.projectSlug,
          shortId: String(quest.shortId),
        },
      })}
      className="hover:bg-hover flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] transition-colors"
    >
      <Icon
        className={cn("size-[14px] shrink-0", BUCKET_ICON_CLASS[bucket])}
        aria-hidden
      />
      <span className="text-muted-foreground w-[46px] shrink-0 font-mono text-[11.5px]">
        {formatReference("quest", quest.shortId)}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          bucket === "completed" && "text-foreground/70",
          bucket === "shelved" && "text-foreground/55 line-through",
        )}
      >
        {quest.title}
      </span>
      {draft && (
        <Badge variant="tint" tone={QUEST_STATUS_TONE.draft}>
          <DraftIcon className="size-3 shrink-0" aria-hidden="true" />
          {tr(QUEST_STATUS_LABEL_KEYS.draft)}
        </Badge>
      )}
      <ReleasePriorityPill
        priority={quest.priority as "optional" | "low" | "medium" | "high"}
      />
    </Link>
  );
};

export default ReleaseQuestRow;
