import { useRouter } from "alepha/react/router";

export interface ReportsQuestListProps {
  quests: Array<{ shortId: number; title: string; detail?: string }>;
  /**
   * Shown instead of the list when there is nothing in it.
   */
  empty: string;
}

/**
 * Quests behind a figure, each opening its quest: the actionable end of a
 * report.
 */
const ReportsQuestList = (props: ReportsQuestListProps) => {
  const router = useRouter();

  if (props.quests.length === 0) {
    return <p className="text-muted-foreground py-2 text-sm">{props.empty}</p>;
  }

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {props.quests.map((quest) => (
        <li key={quest.shortId} className="flex items-center gap-3">
          <a
            {...router.anchor("projectQuest", {
              params: {
                projectSlug: router.state.params.projectSlug,
                shortId: String(quest.shortId),
              },
            })}
            className="min-w-0 flex-1 truncate hover:underline"
          >
            #{quest.shortId} {quest.title}
          </a>
          {quest.detail ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {quest.detail}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

export default ReportsQuestList;
