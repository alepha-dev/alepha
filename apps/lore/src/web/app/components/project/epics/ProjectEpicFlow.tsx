import { useI18n } from "alepha/react/i18n";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestGraph from "../quest/QuestGraph.tsx";

export interface ProjectEpicFlowProps {
  /**
   * `null` while the epic's quests are still loading. Distinct from `[]`,
   * so a failed reload never renders as "this epic has no dependencies".
   */
  quests: QuestResource[] | null;
}

/**
 * The Flow tab: `QuestGraph` in subset mode over the epic's own quests.
 *
 * The graph renders them even when they carry no `dependsOn` edges at all,
 * and keeps an out-of-epic predecessor as a stub node so a blocked quest
 * never looks ready just because its blocker lives in another epic.
 *
 * It fills the tab rather than sitting in a fixed-height band, which is the
 * whole reason it left the Quests card: a dependency graph is the one thing
 * on this page that gets better with more room.
 */
const ProjectEpicFlow = (props: ProjectEpicFlowProps) => {
  const { tr } = useI18n<I18n, "en">();

  if (props.quests === null) {
    return (
      <div className="text-muted-foreground min-h-0 flex-1 p-6 text-center text-sm">
        {tr("epic.quests.loading")}
      </div>
    );
  }

  if (props.quests.length === 0) {
    return (
      <div className="text-muted-foreground min-h-0 flex-1 p-6 text-center text-sm">
        {tr("epic.flow.empty")}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <QuestGraph questIds={new Set(props.quests.map((q) => q.id))} />
    </div>
  );
};

export default ProjectEpicFlow;
