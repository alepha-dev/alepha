import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import QuestHistoryTimeline from "./QuestHistoryTimeline.tsx";

export interface QuestHistoryProps {
  quest: QuestResource;
}

const QuestHistory = (props: QuestHistoryProps) => {
  return (
    <div className="flex flex-1 flex-col py-3">
      {props.quest ? <QuestHistoryTimeline quest={props.quest} /> : null}
    </div>
  );
};

export default QuestHistory;
