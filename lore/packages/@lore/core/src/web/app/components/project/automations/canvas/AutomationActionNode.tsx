import { Badge } from "@alepha/ui";
import type { NodeProps } from "@xyflow/react";
import { useI18n } from "alepha/react/i18n";

import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationCanvasCard from "./AutomationCanvasCard.tsx";
import type { AutomationCanvasNode } from "./AutomationCanvasMap.ts";

/**
 * An action on the canvas (#Q3810): its type and its target; a
 * notification shows its channels as chips and its recipient.
 */
const AutomationActionNode = (props: NodeProps<AutomationCanvasNode>) => {
  const { tr } = useI18n<I18n, "en">();
  const node = props.data.node;
  const names = props.data.names;
  const config = node.config as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string"
      ? value
      : value === undefined || value === null
        ? ""
        : JSON.stringify(value);
  const target =
    node.type === "notify"
      ? config.audience
        ? tr("automation.audience.roster")
        : names?.members[text(config.recipient)] || text(config.recipient)
      : node.type === "appendFolio"
        ? names?.folios[text(config.folio)] || text(config.folio)
        : node.type === "createQuest"
          ? text(config.title)
          : node.type === "assignRelease"
            ? text(config.release)
            : node.type === "addTag"
              ? text(config.tag)
              : "";
  const channels = new AutomationGraph().channels(node);
  return (
    <AutomationCanvasCard
      data={props.data}
      selected={props.selected}
      title={tr(`automation.action.${node.type}`, { default: node.type })}
      target
      ports={["out"]}
    >
      {target && (
        <p
          className="text-muted-foreground truncate"
          title={target}
          data-testid={`automation-node-${node.id}-target`}
        >
          {target}
        </p>
      )}
      {channels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {channels.map((channel) => (
            <Badge key={channel} variant="outline">
              {names?.channels[channel] ??
                tr(`automation.channel.${channel}`, { default: channel })}
            </Badge>
          ))}
        </div>
      )}
    </AutomationCanvasCard>
  );
};

export default AutomationActionNode;
