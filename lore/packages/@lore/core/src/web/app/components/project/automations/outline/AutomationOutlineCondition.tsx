import { useI18n } from "alepha/react/i18n";

import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface AutomationOutlineConditionProps {
  node: AutomationGraphNode;
  /**
   * In a line of text (a folded block), without the field's chip.
   */
  plain?: boolean;
}

/**
 * A condition as words (#Q3847): its field, its comparison, its value.
 */
const AutomationOutlineCondition = (props: AutomationOutlineConditionProps) => {
  const { tr } = useI18n<I18n, "en">();
  const config = props.node.config as {
    field?: unknown;
    operator?: unknown;
    value?: unknown;
  };
  const text = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value ?? "");
  const operator = text(config.operator);
  const comparison = tr(`automation.operator.${operator}`, {
    default: operator,
  });
  if (props.plain)
    return (
      <>
        {tr("automation.outline.if", {
          args: [text(config.field), comparison, text(config.value)],
        })}
      </>
    );
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <code className="bg-foreground/8 rounded px-1.5 py-0.5 font-mono text-[0.85em]">
        {text(config.field) || "..."}
      </code>
      <span className="text-muted-foreground font-normal">{comparison}</span>
      <span>{text(config.value) || "..."}</span>
    </span>
  );
};

export default AutomationOutlineCondition;
