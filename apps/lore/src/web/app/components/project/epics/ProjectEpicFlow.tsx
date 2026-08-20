import { useI18n } from "alepha/react/i18n";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import Questline from "../quest/questline/Questline.tsx";

export interface ProjectEpicFlowProps {
  /**
   * `null` while the epic's quests are still loading. Distinct from `[]`,
   * so a failed reload never renders as "this epic has no dependencies".
   */
  quests: QuestResource[] | null;
  onQuestChange: (quest: QuestResource) => void;
}

/**
 * The Flow tab: the epic's own quests, as the questlines they form.
 *
 * It hands `Questline` the quests the page has **already fetched** rather
 * than letting it fetch its own copy. The surface this replaced kept a
 * second, poorer copy of the whole project's graph and polled it every
 * minute, which is how one browser tab once spent 51 minutes at one request
 * per second (folio #1057). The page owns the data; this tab draws it.
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
    <Questline quests={props.quests} onQuestChange={props.onQuestChange} />
  );
};

export default ProjectEpicFlow;
