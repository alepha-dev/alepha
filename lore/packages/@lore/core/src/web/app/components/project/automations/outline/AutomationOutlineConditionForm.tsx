import { Button } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";

import type { automationCatalogSchema } from "../../../../../../api/schemas/automationCatalogSchema.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationOutlineConditionFields from "./AutomationOutlineConditionFields.tsx";

export interface AutomationOutlineConditionFormProps {
  graph: AutomationGraphValue;
  node: AutomationGraphNode;
  catalog: ReturnType<typeof automationCatalogSchema.parse>;
  disabled: boolean;
  onConfig: (config: Record<string, unknown>) => void;
  onRemove: () => void;
}

/**
 * The condition's row opened in the editor (#Q3848): a field the block's
 * events have in common, how to compare it, and the value.
 */
const AutomationOutlineConditionForm = (
  props: AutomationOutlineConditionFormProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <div
      className="bg-background/60 flex flex-col gap-3 border-t px-4 py-3"
      data-testid="automation-outline-condition-form"
    >
      <AutomationOutlineConditionFields
        key={props.node.id}
        graph={props.graph}
        node={props.node}
        entries={props.catalog.entries}
        variables={props.catalog.variables
          .filter((item) => item.available)
          .map(({ key, kind }) => ({ key, kind }))}
        onChange={props.onConfig}
      />
      <Button
        variant="minimal"
        intent="danger"
        size="sm"
        className="self-start"
        disabled={props.disabled}
        onClick={props.onRemove}
        data-testid="automation-outline-remove-condition"
      >
        <Trash2 className="size-4" />
        {tr("automation.outline.removeCondition")}
      </Button>
    </div>
  );
};

export default AutomationOutlineConditionForm;
