import { useI18n } from "alepha/react/i18n";

import { AutomationGraph } from "../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import { useAutomationLabels } from "./useAutomationLabels.ts";

export interface AutomationRuleSummaryProps {
  rule: AutomationResource;
}

/**
 * An automation's graph as a read-only list of its nodes, in walk order
 * (#Q3805): what each one is and what it is wired to. The canvas replaces
 * it (#Q3810).
 */
const AutomationRuleSummary = (props: AutomationRuleSummaryProps) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const rule = props.rule.rule;
  if (!rule) return null;
  const graphs = new AutomationGraph();
  const kinds: Record<string, string> = {
    source: tr("automation.node.source"),
    read: tr("automation.node.read"),
    condition: tr("automation.node.condition"),
    action: tr("automation.node.action"),
    transform: tr("automation.node.transform"),
  };
  return (
    <ol
      className="flex flex-col gap-2 text-sm"
      data-testid="automation-graph-nodes"
    >
      {graphs.order(rule).map((id) => {
        const node = graphs.node(rule, id)!;
        const next = graphs
          .outgoing(rule, id)
          .map((edge) =>
            edge.port === "out" ? edge.to : `${edge.port}: ${edge.to}`,
          );
        return (
          <li key={id} className="rounded-md border p-3 break-words">
            <p>
              <span className="text-muted-foreground">{kinds[node.kind]}</span>{" "}
              <span className="font-medium">
                {node.kind === "source"
                  ? labels.source(node)
                  : node.kind === "condition"
                    ? `${String(node.config.field)} ${String(node.config.operator)} ${String(node.config.value)}`
                    : node.type}
              </span>{" "}
              <code className="text-muted-foreground text-xs">{id}</code>
              {node.kind === "source" && node.enabled === false && (
                <span className="text-muted-foreground">
                  {" "}
                  ({tr("automation.state.disabled")})
                </span>
              )}
            </p>
            {graphs.channels(node).length > 0 && (
              <p className="text-muted-foreground text-xs">
                {graphs.channels(node).join(", ")}
              </p>
            )}
            {next.length > 0 && (
              <p className="text-muted-foreground text-xs">
                → {next.join(", ")}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default AutomationRuleSummary;
