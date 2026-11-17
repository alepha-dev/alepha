import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { X } from "lucide-react";

import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphEdge } from "../../../../../../api/schemas/automationGraphEdgeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { automationWireFormSchema } from "../../../../../../api/schemas/automationWireFormSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";

export interface AutomationWireListProps {
  graph: AutomationGraphValue;
  node: string;
  ports: AutomationGraphEdge["port"][];
  refuse: (edge: AutomationGraphEdge) => string | undefined;
  onConnect: (edge: AutomationGraphEdge) => void;
  onRemove: (edge: AutomationGraphEdge) => void;
}

/**
 * A node's wires out, from its inspector (#Q3811): each one removable, and
 * a new one drawn by choosing a port and a node, only among the wires the
 * graph allows. What dragging does, by keyboard.
 */
const AutomationWireList = (props: AutomationWireListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const graphs = new AutomationGraph();
  const outgoing = graphs.outgoing(props.graph, props.node);
  const portName = (port: AutomationGraphEdge["port"]) =>
    port === "true"
      ? tr("automation.canvas.port.true")
      : port === "false"
        ? tr("automation.canvas.port.false")
        : "";
  const choices = props.ports.flatMap((port) =>
    props.graph.nodes
      .filter((node) => !props.refuse({ from: props.node, port, to: node.id }))
      .map((node) => ({
        value: `${port}:${node.id}`,
        label: port === "out" ? node.id : `${portName(port)} → ${node.id}`,
      })),
  );
  const form = useForm({
    schema: automationWireFormSchema,
    initialValues: {},
    handler: (values) => {
      if (!values.target) return;
      const [port, ...rest] = values.target.split(":");
      props.onConnect({
        from: props.node,
        port: port as AutomationGraphEdge["port"],
        to: rest.join(":"),
      });
      form.input.target.set(undefined);
    },
  });
  return (
    <div className="flex flex-col gap-2" data-testid="automation-wires">
      <span className="text-muted-foreground text-xs font-medium">
        {tr("automation.canvas.wires")}
      </span>
      {outgoing.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {outgoing.map((edge) => (
            <li
              key={`${edge.port}:${edge.to}`}
              className="flex items-center justify-between gap-2"
            >
              <span>
                {edge.port !== "out" && (
                  <span className="text-muted-foreground">
                    {portName(edge.port)}{" "}
                  </span>
                )}
                → <span className="font-mono">{edge.to}</span>
              </span>
              <Button
                variant="minimal"
                size="icon"
                aria-label={tr("automation.canvas.wire.remove", {
                  args: [edge.to],
                })}
                onClick={() => props.onRemove(edge)}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {choices.length > 0 && (
        <form {...form.props} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Control
              input={form.input.target}
              label={tr("automation.canvas.wire.to")}
              select
              items={choices}
            />
          </div>
          <Button type="submit" variant="outlined">
            {tr("automation.canvas.wire.add")}
          </Button>
        </form>
      )}
    </div>
  );
};

export default AutomationWireList;
