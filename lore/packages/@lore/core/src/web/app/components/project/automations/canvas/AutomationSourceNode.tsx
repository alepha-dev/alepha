import { Tooltip, TooltipContent, TooltipTrigger } from "@alepha/ui";
import type { NodeProps } from "@xyflow/react";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../../services/I18n.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";
import AutomationCanvasCard from "./AutomationCanvasCard.tsx";
import type { AutomationCanvasNode } from "./AutomationCanvasMap.ts";
import AutomationCanvasValues from "./AutomationCanvasValues.tsx";

/**
 * A source on the canvas (#Q3810): its event or schedule, its filters, and
 * its state dot, broken with the reason on hover.
 */
const AutomationSourceNode = (props: NodeProps<AutomationCanvasNode>) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const node = props.data.node;
  const source = props.data.source;
  const state = !source
    ? undefined
    : !source.enabled
      ? "off"
      : source.health === "broken"
        ? "broken"
        : "active";
  const names = {
    active: tr("automation.state.active"),
    off: tr("automation.canvas.source.off"),
    broken: tr("automation.state.broken"),
  };
  const dots = {
    active: "bg-success",
    off: "bg-muted-foreground/50",
    broken: "bg-danger",
  };
  const filters = node.type === "schedule" ? {} : node.config;
  return (
    <AutomationCanvasCard
      data={props.data}
      selected={props.selected}
      title={labels.source(node)}
      target={false}
      ports={["out"]}
      status={
        state && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="flex items-center gap-1 normal-case"
                  data-testid={`automation-node-${node.id}-state`}
                  data-state={state}
                />
              }
            >
              <span className={`size-2 rounded-full ${dots[state]}`} />
              {names[state]}
            </TooltipTrigger>
            <TooltipContent>{source?.reason || names[state]}</TooltipContent>
          </Tooltip>
        )
      }
    >
      <AutomationCanvasValues values={filters} />
    </AutomationCanvasCard>
  );
};

export default AutomationSourceNode;
