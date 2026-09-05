import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Link2, SquareCheck } from "lucide-react";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../shared/element/typedReference.ts";

/**
 * The questline as `QuestView` already fetched it — passed down rather than
 * re-fetched, so opening a quest still costs one `getQuestLine`.
 *
 * Declared here rather than in `QuestViewRail`, which used to own it: the
 * rail no longer takes a questline at all, and this banner is the only
 * consumer left.
 */
export interface QuestlineSummary {
  predecessor?: QuestlineNode;
  dependents: QuestlineNode[];
}

/**
 * One end of a questline link.
 *
 * `completedAt` / `shelvedAt` are what let a reader tell "blocked" from
 * "unblocked" and from "blocked by something parked". They were missing
 * here while `QuestView`'s own state carried them, so anything typed
 * against this interface could not see the difference.
 */
export interface QuestlineNode {
  id: number;
  shortId: number;
  title: string;
  completedAt?: string;
  shelvedAt?: string;
}

export interface QuestViewQuestlineProps {
  quest: QuestResource;
  questline: QuestlineSummary;
}

/**
 * The questline banner: what blocks this quest, and what it unblocks.
 *
 * A full-width bar rather than the centred pill it used to be. The pill
 * floated in the middle of the column at 12px, which read as a caption about
 * the quest instead of a constraint on it, and truncated the predecessor's
 * title to nothing on a narrow column.
 *
 * Three roles, three weights: the relation ("Blocked by") is body text, the
 * id is the anchor you click to reach that quest, and the title is muted
 * because it is context rather than a destination. The whole row used to be
 * one link to the graph, so there was no way to open the quest that was
 * actually blocking you.
 */
const QuestViewQuestline = (props: QuestViewQuestlineProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const projectSlug = project?.slug ?? "";

  const { predecessor, dependents } = props.questline;
  if (!predecessor && dependents.length === 0) {
    return null;
  }

  const questHref = (shortId: number) =>
    router.path("projectQuest", {
      params: { projectSlug, shortId: String(shortId) },
    });

  /**
   * The route name still says `graph` and the path still ends `/graph` - it
   * is a link people hold - but what it opens is the questline map. For a
   * quest that belongs to an epic the loader redirects to that epic's Flow
   * tab, which draws the same map beside the epic's own chrome, so this one
   * label is honest either way.
   */
  const questlineHref = router.path("projectQuestGraph", {
    params: { projectSlug, shortId: String(props.quest.shortId) },
  });

  const done = !!predecessor?.completedAt;

  const row = (
    label: string,
    shortId: number,
    title: string,
    tone: string,
    icon: React.ReactNode,
  ) => (
    <div
      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm ${tone}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="shrink-0">{label}</span>
      <Link
        href={questHref(shortId)}
        className="bg-background/40 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-xs hover:underline"
      >
        {formatReference("quest", shortId)}
      </Link>
      <span className="text-muted-foreground min-w-0 truncate">{title}</span>
      <Link
        href={questlineHref}
        className="text-muted-foreground hover:text-foreground ml-auto shrink-0 text-xs hover:underline"
      >
        {tr("quest.view.questline.open")}
      </Link>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {predecessor &&
        row(
          String(
            done
              ? tr("quest.view.questline.unblocked")
              : predecessor.shelvedAt
                ? // A shelved predecessor never completes on its own, so say
                  // so rather than implying the block will clear by itself.
                  tr("quest.view.questline.blockedByShelved")
                : tr("quest.view.questline.blockedBy"),
          ),
          predecessor.shortId,
          predecessor.title,
          done
            ? "border-emerald-500/40 bg-emerald-500/10"
            : "border-amber-500/40 bg-amber-500/10",
          done ? (
            <SquareCheck className="size-4 text-emerald-500" />
          ) : (
            <Link2 className="size-4 text-amber-500" />
          ),
        )}

      {dependents.map((dep) =>
        row(
          String(tr("quest.view.questline.unlocks")),
          dep.shortId,
          dep.title,
          "border-border bg-muted/40",
          <Link2 className="text-muted-foreground size-4 rotate-90" />,
        ),
      )}
    </div>
  );
};

export default QuestViewQuestline;
