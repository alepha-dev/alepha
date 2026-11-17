import type { NodeProps } from "@xyflow/react";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../../services/I18n.ts";
import AutomationCanvasCard from "./AutomationCanvasCard.tsx";
import type { AutomationCanvasNode } from "./AutomationCanvasMap.ts";

/**
 * A condition on the canvas (#Q3810): the comparison, and a `true` and a
 * `false` port.
 */
const AutomationConditionNode = (props: NodeProps<AutomationCanvasNode>) => {
  const { tr } = useI18n<I18n, "en">();
  const config = props.data.node.config as {
    field?: unknown;
    operator?: unknown;
    value?: unknown;
  };
  const text = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value ?? "");
  const operator = text(config.operator);
  const value = text(config.value);
  return (
    <AutomationCanvasCard
      data={props.data}
      selected={props.selected}
      title={
        <>
          <span className="font-mono">{text(config.field)}</span>{" "}
          <span className="text-muted-foreground font-normal">
            {tr(`automation.operator.${operator}`, { default: operator })}
          </span>{" "}
          <span className="font-mono">{value}</span>
        </>
      }
      target
      ports={["true", "false"]}
    />
  );
};

export default AutomationConditionNode;
