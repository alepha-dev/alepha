import { useI18n } from "alepha/react/i18n";

import type { AutomationAction } from "../../../../../../api/schemas/automationActionSchema.ts";
import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { automationCatalogSchema } from "../../../../../../api/schemas/automationCatalogSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationActionEditor from "../AutomationActionEditor.tsx";
import AutomationOutlineActionMenu from "./AutomationOutlineActionMenu.tsx";
import AutomationOutlinePlaceholders from "./AutomationOutlinePlaceholders.tsx";
import { useAutomationOutlineInsert } from "./useAutomationOutlineInsert.ts";

export interface AutomationOutlineActionFormProps {
  graph: AutomationGraphValue;
  node: AutomationGraphNode;
  /**
   * Its place in the outline's walk, for the editor's label.
   */
  index: number;
  catalog: ReturnType<typeof automationCatalogSchema.parse>;
  actions: Array<{ nodeType: AutomationCatalogNodeType; reason?: string }>;
  disabled: boolean;
  onConfig: (config: Record<string, unknown>) => void;
  onType: (nodeType: AutomationCatalogNodeType) => void;
  onStep: (nodeType: AutomationCatalogNodeType) => void;
  onRemove: () => void;
}

/**
 * An action's row opened in the editor (#Q3848): `AutomationActionEditor`,
 * shared-variable binding included; under it the names the step may use
 * as chips, and "Add a step after this one".
 */
const AutomationOutlineActionForm = (
  props: AutomationOutlineActionFormProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const graphs = new AutomationGraph();
  const insert = useAutomationOutlineInsert();
  const node = props.node;
  const catalog = props.catalog;
  const variables = catalog.variables
    .filter((item) => item.available)
    .map(({ key, kind }) => ({ key, kind }));
  const reaching = graphs.reachingSources(props.graph, node.id);
  return (
    <div
      className="bg-background/60 flex flex-col gap-3 border-t px-4 py-3"
      onFocusCapture={insert.onFocusCapture}
      data-testid="automation-outline-action-form"
    >
      <AutomationActionEditor
        key={`${node.id}:${node.type}`}
        index={props.index}
        action={{ kind: node.type, ...node.config } as AutomationAction}
        entries={catalog.entries.filter(
          (item) =>
            item.type === "action" &&
            (item.available || item.key === node.type),
        )}
        bindings={[
          ...Object.entries(
            graphs.names(props.graph, node.id, catalog.entries),
          ).map(([key, kind]) => ({ key, kind })),
          ...variables,
        ]}
        channels={catalog.channels
          .filter((item) => item.available)
          .map((item) => item.key)}
        rooms={catalog.channels
          .filter((item) => !item.addressable)
          .map((item) => item.key)}
        channelNames={Object.fromEntries(
          catalog.channels
            .filter((item) => item.kind !== item.key && item.name)
            .map((item) => [item.key, item.name!]),
        )}
        allowAudience={
          reaching.length > 0 &&
          reaching.every(
            (id) => graphs.node(props.graph, id)?.type === "release.published",
          )
        }
        disabled={props.disabled}
        removable
        onKind={(key) => {
          const nodeType = catalog.nodeTypes.find(
            (item) => item.kind === "action" && item.type === key,
          );
          if (nodeType) props.onType(nodeType);
        }}
        onChange={(key, value) =>
          props.onConfig(
            Object.fromEntries(
              Object.entries({
                ...node.config,
                [key]: value,
                // A stored graph names `channels` (#Q3613).
                ...(key === "channels" ? { channel: undefined } : {}),
                ...(key === "audience" && value
                  ? { recipient: undefined, category: "releases" }
                  : {}),
              }).filter(([, field]) => field !== undefined),
            ),
          )
        }
        onRemove={props.onRemove}
      />
      <AutomationOutlinePlaceholders
        graph={props.graph}
        node={node.id}
        entries={catalog.entries}
        onInsert={(name) => void insert.insert(name)}
      />
      <div>
        <AutomationOutlineActionMenu
          label={tr("automation.outline.addStep")}
          actions={props.actions}
          disabled={props.disabled}
          onPick={props.onStep}
          testId={`automation-outline-add-step-${node.id}`}
        />
      </div>
    </div>
  );
};

export default AutomationOutlineActionForm;
