import type {
  I18n,
  ResourceRailEntry,
  ResourceRailSubject,
} from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import type { LucideIcon } from "lucide-react";

import QuestViewRailRow from "./QuestViewRailRow.tsx";

export interface QuestViewRailSlotProps {
  entry: ResourceRailEntry;
  subject: ResourceRailSubject;
}

/**
 * One row another module registered on the quest rail (core's
 * `ResourceRailRegistry`, #E154): Ship's Live row. A component per row, so
 * the entry's `useValue` hook is called the same way on every render.
 */
const QuestViewRailSlot = (props: QuestViewRailSlotProps) => {
  const { tr } = useI18n<I18n, "en">();
  const value = props.entry.useValue(props.subject);
  return (
    <QuestViewRailRow
      icon={props.entry.icon as LucideIcon}
      // The key is the registering module's own: core's `I18n` type cannot
      // name it.
      label={tr(props.entry.labelKey as never)}
    >
      {value}
    </QuestViewRailRow>
  );
};

export default QuestViewRailSlot;
