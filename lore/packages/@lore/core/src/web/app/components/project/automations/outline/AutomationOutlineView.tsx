import { cn } from "@alepha/ui";

import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { AutomationNodeOutcome } from "../../../../../../api/schemas/automationNodeOutcomeSchema.ts";
import { AutomationOutline } from "../../../../../../api/schemas/AutomationOutline.ts";
import type { AutomationResourceSource } from "../../../../../../api/schemas/automationResourceSourceSchema.ts";
import AutomationOutlineBlockView, {
  type AutomationOutlineSwitches,
} from "./AutomationOutlineBlockView.tsx";
import AutomationOutlineNotice from "./AutomationOutlineNotice.tsx";
import { AutomationOutlineTones } from "./AutomationOutlineTones.ts";
import type { AutomationOutlineNames } from "./useAutomationOutlineNames.ts";

export interface AutomationOutlineViewProps {
  graph: AutomationGraphValue;
  /**
   * The names of the ids the actions hold, from
   * `useAutomationOutlineNames`: the page reads them.
   */
  names?: AutomationOutlineNames;
  sources?: AutomationResourceSource[];
  /**
   * Each event's switch, acting at once (the automation page).
   */
  switches?: AutomationOutlineSwitches;
  /**
   * A run's per-node evidence: the outline paints what each row did.
   */
  outcomes?: AutomationNodeOutcome[];
  /**
   * Deletes the automation, offered when the graph is not an outline.
   */
  onDelete?: () => void;
  busy?: boolean;
}

/**
 * An automation read as an outline (#Q3847), on its page and on a run's:
 * its blocks on a tinted ground, several of them each folded into one
 * line. A graph the outline rules refuse shows a notice instead.
 */
const AutomationOutlineView = (props: AutomationOutlineViewProps) => {
  const outline = new AutomationOutline();
  const reading = outline.read(props.graph);
  if (!reading.outline)
    return (
      <AutomationOutlineNotice
        reason={reading.message}
        onDelete={props.onDelete}
        busy={props.busy}
      />
    );
  const outcomes = props.outcomes ? outline.fold(props.outcomes) : undefined;
  const several = reading.blocks.length > 1 && !outcomes;
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl p-3 sm:p-4",
        AutomationOutlineTones.CANVAS,
      )}
      data-testid="automation-outline"
    >
      {reading.blocks.map((block) => (
        <AutomationOutlineBlockView
          key={block.key}
          block={block}
          names={props.names}
          sources={props.sources}
          switches={props.switches}
          outcomes={outcomes}
          folded={several}
        />
      ))}
    </div>
  );
};

export default AutomationOutlineView;
