import { Badge } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { AutomationDescriptor } from "../../../../../../api/schemas/automationDescriptorSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface AutomationPlaceholderListProps {
  graph: AutomationGraphValue;
  node: string;
  entries: readonly AutomationDescriptor[];
}

/**
 * The placeholders a node may use (#Q3811): the fields every source that
 * reaches it gives, and the outputs of the actions on every path to it. A
 * field only some of those sources give is listed apart, naming the
 * sources that lack it.
 */
const AutomationPlaceholderList = (props: AutomationPlaceholderListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const graphs = new AutomationGraph();
  const names = Object.keys(
    graphs.names(props.graph, props.node, props.entries),
  ).sort();
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
      lacking: sources.filter((source) => !fields.get(source)?.has(name)),
    }));
  if (!names.length && !missing.length) return null;
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="automation-placeholders"
    >
      <span className="text-muted-foreground text-xs font-medium">
        {tr("automation.canvas.placeholders")}
      </span>
      <div className="flex flex-wrap gap-1">
        {names.map((name) => (
          <Badge key={name} variant="outline" className="font-mono">
            {`{{${name}}}`}
          </Badge>
        ))}
      </div>
      {missing.length > 0 && (
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
          {missing.map((item) => (
            <li
              key={item.name}
              data-testid={`automation-placeholder-missing-${item.name}`}
            >
              <span className="font-mono line-through">{`{{${item.name}}}`}</span>{" "}
              {tr("automation.canvas.placeholders.lacking", {
                args: [item.lacking.join(", ")],
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AutomationPlaceholderList;
