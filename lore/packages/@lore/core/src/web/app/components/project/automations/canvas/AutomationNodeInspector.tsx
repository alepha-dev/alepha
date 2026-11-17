import { Button, Checkbox, Label } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";

import type { AutomationAction } from "../../../../../../api/schemas/automationActionSchema.ts";
import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { automationCatalogSchema } from "../../../../../../api/schemas/automationCatalogSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphEdge } from "../../../../../../api/schemas/automationGraphEdgeSchema.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationActionEditor from "../AutomationActionEditor.tsx";
import AutomationValueControl from "../AutomationValueControl.tsx";
import { useAutomationLabels } from "../useAutomationLabels.ts";
import AutomationConditionInspector from "./AutomationConditionInspector.tsx";
import AutomationPlaceholderList from "./AutomationPlaceholderList.tsx";
import AutomationWireList from "./AutomationWireList.tsx";

export interface AutomationNodeInspectorProps {
  graph: AutomationGraphValue;
  node: AutomationGraphNode;
  catalog: ReturnType<typeof automationCatalogSchema.parse>;
  issues: string[];
  onChange: (
    change: (node: AutomationGraphNode) => AutomationGraphNode,
  ) => void;
  onRetype: (nodeType: AutomationCatalogNodeType) => void;
  onRemove: () => void;
  refuse: (edge: AutomationGraphEdge) => string | undefined;
  onConnect: (edge: AutomationGraphEdge) => void;
  onRemoveEdge: (edge: AutomationGraphEdge) => void;
}

/**
 * The selected node's inspector (#Q3811), built from the form's pieces: a
 * source's filters or schedule and its switch, a read's filters, a
 * condition's comparison, an action's editor. Below, the placeholders it
 * may use and its wires out. Every change is a step of the draft.
 */
const AutomationNodeInspector = (props: AutomationNodeInspectorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const graphs = new AutomationGraph();
  const node = props.node;
  const catalog = props.catalog;
  const entry = catalog.entries.find((item) => item.key === node.type);
  const variables = catalog.variables
    .filter((item) => item.available)
    .map(({ key, kind }) => ({ key, kind }));
  const kinds: Record<string, string> = {
    source: tr("automation.node.source"),
    read: tr("automation.node.read"),
    condition: tr("automation.node.condition"),
    action: tr("automation.node.action"),
    transform: tr("automation.node.transform"),
  };
  const configure = (config: Record<string, unknown>) =>
    props.onChange((current) => ({ ...current, config }));
  const filters = (
    current: Record<string, unknown>,
    key: string,
    value: unknown,
  ) => {
    const next = { ...current };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    return next;
  };
  const reaching = graphs.reachingSources(props.graph, node.id);
  const ports: AutomationGraphEdge["port"][] =
    node.kind === "condition" ? ["true", "false"] : ["out"];
  const actions = graphs
    .order(props.graph)
    .filter((id) => graphs.node(props.graph, id)?.kind === "action");
  return (
    <aside
      className="bg-card flex w-full flex-col gap-4 rounded-lg border p-4 lg:w-96 lg:shrink-0"
      aria-label={tr("automation.canvas.inspector")}
      data-testid="automation-node-inspector"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium uppercase">
            {kinds[node.kind] ?? node.kind}
          </p>
          <p className="font-medium break-words">
            {node.kind === "source"
              ? labels.source(node)
              : node.kind === "action"
                ? tr(`automation.action.${node.type}`, { default: node.type })
                : node.kind === "read"
                  ? tr(`automation.source.${node.type}`, { default: node.type })
                  : tr("automation.canvas.compare")}
          </p>
          <p className="text-muted-foreground font-mono text-xs">{node.id}</p>
        </div>
        <Button
          variant="minimal"
          size="icon"
          intent="danger"
          aria-label={tr("automation.canvas.removeNode", { args: [node.id] })}
          data-testid="automation-node-remove"
          onClick={props.onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {props.issues.length > 0 && (
        <ul
          role="alert"
          className="text-danger-text flex flex-col gap-1 text-sm"
        >
          {props.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {node.kind === "source" && (
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={node.enabled !== false}
            data-testid="automation-node-enabled"
            onCheckedChange={(checked) =>
              props.onChange((current) => {
                const { enabled: _enabled, ...rest } = current;
                return checked ? rest : { ...rest, enabled: false };
              })
            }
          />
          {tr("automation.canvas.source.enabled")}
        </Label>
      )}
      {node.kind === "source" && node.type === "schedule" && (
        <AutomationValueControl
          label={tr("automation.canvas.cron")}
          slot={{ kind: "text", required: true, max: 128 }}
          value={node.config.cron}
          bindings={variables}
          disabled={false}
          onChange={(value) =>
            configure({ cron: typeof value === "string" ? value : "" })
          }
        />
      )}
      {node.kind === "source" &&
        node.type !== "schedule" &&
        Object.entries(entry?.slots ?? {}).map(([key, slot]) => (
          <AutomationValueControl
            key={`${node.id}:${key}`}
            label={tr(`automation.setup.${key}`, { default: key })}
            slot={slot}
            value={node.config[key]}
            bindings={variables}
            disabled={false}
            onChange={(value) => configure(filters(node.config, key, value))}
          />
        ))}
      {node.kind === "read" &&
        Object.entries(entry?.slots ?? {}).map(([key, slot]) => {
          const current = (node.config.filters ?? {}) as Record<
            string,
            unknown
          >;
          return (
            <AutomationValueControl
              key={`${node.id}:${key}`}
              label={tr(`automation.setup.${key}`, { default: key })}
              slot={slot}
              value={current[key]}
              bindings={variables}
              disabled={false}
              onChange={(value) =>
                configure({
                  ...node.config,
                  filters: filters(current, key, value),
                })
              }
            />
          );
        })}
      {node.kind === "condition" && (
        <AutomationConditionInspector
          key={node.id}
          graph={props.graph}
          node={node}
          entries={catalog.entries}
          variables={variables}
          onChange={configure}
        />
      )}
      {node.kind === "action" && (
        <AutomationActionEditor
          key={`${node.id}:${node.type}`}
          index={Math.max(0, actions.indexOf(node.id))}
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
              (id) =>
                graphs.node(props.graph, id)?.type === "release.published",
            )
          }
          disabled={false}
          removable
          onKind={(key) => {
            const nodeType = catalog.nodeTypes.find(
              (item) => item.kind === "action" && item.type === key,
            );
            if (nodeType) props.onRetype(nodeType);
          }}
          onChange={(key, value) =>
            configure(
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
      )}
      {(node.kind === "condition" || node.kind === "action") && (
        <AutomationPlaceholderList
          graph={props.graph}
          node={node.id}
          entries={catalog.entries}
        />
      )}
      <AutomationWireList
        key={node.id}
        graph={props.graph}
        node={node.id}
        ports={ports}
        refuse={props.refuse}
        onConnect={props.onConnect}
        onRemove={props.onRemoveEdge}
      />
    </aside>
  );
};

export default AutomationNodeInspector;
