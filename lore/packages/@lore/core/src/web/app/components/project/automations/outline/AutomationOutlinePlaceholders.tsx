import { Badge } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { AutomationDescriptor } from "../../../../../../api/schemas/automationDescriptorSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationOutlinePlaceholderLacking from "./AutomationOutlinePlaceholderLacking.tsx";

export interface AutomationOutlinePlaceholdersProps {
  graph: AutomationGraphValue;
  node: string;
  entries: readonly AutomationDescriptor[];
  /**
   * Writes `{{name}}` into the field focused last.
   */
  onInsert: (name: string) => void;
}

/**
 * The names a step may use (#Q3848), as chips under its fields: each says
 * where it comes from, the event or a step above, and a click writes it
 * into the text field focused last.
 */
const AutomationOutlinePlaceholders = (
  props: AutomationOutlinePlaceholdersProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const graphs = new AutomationGraph();
  const names = graphs.names(props.graph, props.node, props.entries);
  const outputs = graphs.outputs(props.graph, props.node, props.entries);
  const items = Object.keys(names)
    .sort()
    .map((name) => {
      const producer = outputs[name]?.producer;
      const node = producer ? graphs.node(props.graph, producer) : undefined;
      return {
        name,
        from: node
          ? tr("automation.outline.from.step", {
              args: [
                tr(`automation.action.${node.type}`, { default: node.type }),
              ],
            })
          : tr("automation.outline.from.event"),
      };
    });
  if (!items.length)
    return (
      <AutomationOutlinePlaceholderLacking
        graph={props.graph}
        node={props.node}
        entries={props.entries}
      />
    );
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="automation-outline-placeholders"
    >
      <span className="text-muted-foreground text-xs font-medium">
        {tr("automation.outline.placeholders")}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge
            key={item.name}
            variant="outline"
            className="cursor-pointer font-mono"
            title={item.from}
            render={
              <button
                type="button"
                // Keep the field's focus and caret: the chip writes there.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onInsert(item.name)}
                data-testid={`automation-outline-placeholder-${item.name}`}
              />
            }
          >
            {item.name}
            <span className="text-muted-foreground font-sans text-[0.7rem]">
              {item.from}
            </span>
          </Badge>
        ))}
      </div>
      <AutomationOutlinePlaceholderLacking
        graph={props.graph}
        node={props.node}
        entries={props.entries}
      />
    </div>
  );
};

export default AutomationOutlinePlaceholders;
