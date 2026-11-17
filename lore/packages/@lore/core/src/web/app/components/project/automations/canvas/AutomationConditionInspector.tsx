import { Control } from "@alepha/ui/form";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import { automationConditionFormSchema } from "../../../../../../api/schemas/automationConditionFormSchema.ts";
import type { AutomationDescriptor } from "../../../../../../api/schemas/automationDescriptorSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { AutomationGuard } from "../../../../../../api/schemas/automationGuardSchema.ts";
import type { AutomationSlotKind } from "../../../../../../api/schemas/automationSlotKindSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationValueControl from "../AutomationValueControl.tsx";

export interface AutomationConditionInspectorProps {
  graph: AutomationGraphValue;
  node: AutomationGraphNode;
  entries: readonly AutomationDescriptor[];
  /**
   * The shared variables the value may be bound to.
   */
  variables: { key: string; kind: AutomationSlotKind }[];
  onChange: (config: Record<string, unknown>) => void;
}

/**
 * A condition's inspector (#Q3811): a field the node may compare (one
 * every source reaching it gives), how, and the value, literal or bound.
 */
const AutomationConditionInspector = (
  props: AutomationConditionInspectorProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const graphs = new AutomationGraph();
  const fields = graphs.names(props.graph, props.node.id, props.entries);
  const config = props.node.config as {
    field?: string;
    operator?: string;
    value?: unknown;
  };
  const field = config.field || undefined;
  const kind = field ? fields[field] : undefined;
  // What the read before it supports beyond plain comparisons: a scalar's
  // `delta` and `crossesAbove`.
  const extra = [...graphs.upstream(props.graph, props.node.id)]
    .map((id) => graphs.node(props.graph, id))
    .filter((node) => node?.kind === "read")
    .flatMap(
      (node) =>
        props.entries.find((entry) => entry.key === node!.type)?.operators ??
        [],
    );
  const operators = [
    ...new Set(
      kind === "number"
        ? ["eq", "ne", "lt", "lte", "gt", "gte", ...extra]
        : ["eq", "ne"],
    ),
  ];
  const form = useForm({
    schema: automationConditionFormSchema,
    handler: () => undefined,
    initialValues: {
      ...(field ? { field } : {}),
      operator: (config.operator ?? "eq") as AutomationGuard["operator"],
    },
    onChange: (name, value) => {
      if (name === "field")
        props.onChange({
          ...config,
          field: value ? String(value) : "",
          operator: "eq",
          value: fields[String(value)] === "number" ? 0 : "",
        });
      if (name === "operator")
        props.onChange({ ...config, operator: String(value) });
    },
  });
  return (
    <div className="flex flex-col gap-3">
      <Control
        input={form.input.field}
        label={tr("automation.canvas.condition.field")}
        select
        items={Object.keys(fields)
          .sort()
          .map((value) => ({ value, label: value }))}
      />
      {field && (
        <>
          <Control
            input={form.input.operator}
            label={tr("automation.canvas.condition.operator")}
            select
            items={operators.map((value) => ({
              value,
              label: tr(`automation.operator.${value}`, { default: value }),
            }))}
          />
          <AutomationValueControl
            key={field}
            label={tr("automation.editor.value")}
            slot={{ kind: kind ?? "text", required: true }}
            value={config.value}
            bindings={[
              ...Object.entries(fields).map(([key, value]) => ({
                key,
                kind: value,
              })),
              ...props.variables,
            ]}
            disabled={false}
            onChange={(value) => props.onChange({ ...config, value })}
          />
        </>
      )}
    </div>
  );
};

export default AutomationConditionInspector;
