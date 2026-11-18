import { useI18n } from "alepha/react/i18n";

import type { AutomationDescriptor } from "../../../../../../api/schemas/automationDescriptorSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";

export interface AutomationOutlinePlaceholderLackingProps {
  graph: AutomationGraphValue;
  node: string;
  entries: readonly AutomationDescriptor[];
}

/**
 * The names a step may NOT use (#Q3811, the outline's since #Q3850): a
 * field only some of its block's events give, struck through, naming the
 * events that lack it. A step sees only what every event gives.
 */
const AutomationOutlinePlaceholderLacking = (
  props: AutomationOutlinePlaceholderLackingProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const graphs = new AutomationGraph();
  const names = Object.keys(
    graphs.names(props.graph, props.node, props.entries),
  );
  const sources = graphs.reachingSources(props.graph, props.node);
  const fields = new Map(
    sources.map((source) => [
      source,
      new Set(Object.keys(graphs.fieldsOf(props.graph, source, props.entries))),
    ]),
  );
  const missing = [...new Set([...fields.values()].flatMap((set) => [...set]))]
    .filter((name) => !names.includes(name))
    .sort()
    .map((name) => ({
      name,
      lacking: sources
        .filter((source) => !fields.get(source)?.has(name))
        .map((source) => labels.source(graphs.node(props.graph, source)!)),
    }));
  if (!missing.length) return null;
  return (
    <ul
      className="text-muted-foreground flex flex-col gap-0.5 text-xs"
      data-testid="automation-outline-placeholders-lacking"
    >
      {missing.map((item) => (
        <li key={item.name}>
          <span className="font-mono line-through">{item.name}</span>{" "}
          {tr("automation.outline.placeholders.lacking", {
            args: [[...new Set(item.lacking)].join(", ")],
          })}
        </li>
      ))}
    </ul>
  );
};

export default AutomationOutlinePlaceholderLacking;
