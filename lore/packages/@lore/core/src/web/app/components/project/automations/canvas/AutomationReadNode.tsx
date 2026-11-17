import type { NodeProps } from "@xyflow/react";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../../services/I18n.ts";
import AutomationCanvasCard from "./AutomationCanvasCard.tsx";
import type { AutomationCanvasNode } from "./AutomationCanvasMap.ts";
import AutomationCanvasValues from "./AutomationCanvasValues.tsx";

/**
 * A read on the canvas (#Q3810): what a schedule reads, and its filters.
 */
const AutomationReadNode = (props: NodeProps<AutomationCanvasNode>) => {
  const { tr } = useI18n<I18n, "en">();
  const node = props.data.node;
  const filters = (node.config.filters ?? {}) as Record<string, unknown>;
  return (
    <AutomationCanvasCard
      data={props.data}
      selected={props.selected}
      title={tr(`automation.source.${node.type}`, { default: node.type })}
      target
      ports={["out"]}
    >
      <AutomationCanvasValues values={filters} />
    </AutomationCanvasCard>
  );
};

export default AutomationReadNode;
