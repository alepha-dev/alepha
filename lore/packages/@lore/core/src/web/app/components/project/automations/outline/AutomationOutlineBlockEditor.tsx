import { Badge, Button, Card, Switch, useDialog } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { ChevronUp, CornerDownRight, Filter, Trash2 } from "lucide-react";

import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { automationCatalogSchema } from "../../../../../../api/schemas/automationCatalogSchema.ts";
import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import {
  AutomationOutline,
  type AutomationOutlineBlock,
  type AutomationOutlineSide,
} from "../../../../../../api/schemas/AutomationOutline.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";
import AutomationOutlineActionForm from "./AutomationOutlineActionForm.tsx";
import AutomationOutlineActionMenu from "./AutomationOutlineActionMenu.tsx";
import type { AutomationOutlineCheck } from "./AutomationOutlineAside.tsx";
import AutomationOutlineCondition from "./AutomationOutlineCondition.tsx";
import AutomationOutlineConditionForm from "./AutomationOutlineConditionForm.tsx";
import AutomationOutlineEventForm from "./AutomationOutlineEventForm.tsx";
import AutomationOutlineEventMenu from "./AutomationOutlineEventMenu.tsx";
import AutomationOutlineFolded from "./AutomationOutlineFolded.tsx";
import { AutomationOutlineIcons } from "./AutomationOutlineIcons.ts";
import AutomationOutlineRow from "./AutomationOutlineRow.tsx";
import AutomationOutlineSection from "./AutomationOutlineSection.tsx";
import AutomationOutlineSummary from "./AutomationOutlineSummary.tsx";
import type { AutomationOutlineTone } from "./AutomationOutlineTones.ts";
import type { AutomationOutlineNames } from "./useAutomationOutlineNames.ts";

export interface AutomationOutlineBlockEditorProps {
  graph: AutomationGraphValue;
  block: AutomationOutlineBlock;
  catalog: ReturnType<typeof automationCatalogSchema.parse>;
  names?: AutomationOutlineNames;
  /**
   * What "Before you save" says, by node id: shown on the row it names.
   */
  issues: Record<string, AutomationOutlineCheck[]>;
  /**
   * The row open in place, one for the whole editor.
   */
  open?: string;
  onOpen: (id: string | undefined) => void;
  /**
   * One of several blocks: it folds into one line.
   */
  folded: boolean;
  onFold: (folded: boolean) => void;
  /**
   * Whether the block may be removed: one of several.
   */
  removable: boolean;
  disabled: boolean;
  /**
   * Applies an edit of the draft, and opens the row it names.
   */
  onChange: (
    edit: (graph: AutomationGraphValue) => AutomationGraphValue,
  ) => void;
  onAdd: (
    edit: (graph: AutomationGraphValue) => {
      graph: AutomationGraphValue;
      id: string;
    },
  ) => void;
}

/**
 * One block in the editor (#Q3848): its rows open in place into their
 * forms, and every add and remove is an edit of `AutomationOutline`, so the
 * draft stays an outline.
 */
const AutomationOutlineBlockEditor = (
  props: AutomationOutlineBlockEditorProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const dialog = useDialog();
  const outline = new AutomationOutline();
  const graphs = new AutomationGraph();
  const block = props.block;
  const catalog = props.catalog;
  const schedule = !!block.read;
  const toggle = (id: string) => () =>
    props.onOpen(props.open === id ? undefined : id);
  const sources = graphs.sources(props.graph);
  const events = catalog.nodeTypes
    .filter((item) => item.kind === "source" && item.type !== "schedule")
    .map((nodeType) => ({
      nodeType,
      reason: !nodeType.available
        ? (nodeType.reason ?? tr("automation.outline.unavailable"))
        : sources.length >= AutomationGraph.MAX_SOURCES
          ? tr("automation.outline.unavailable.sources", {
              args: [String(AutomationGraph.MAX_SOURCES)],
            })
          : undefined,
    }));
  const count = block.sequences.flat().length + block.otherwise.flat().length;
  const actions = catalog.nodeTypes
    .filter(
      (item) =>
        item.kind === "action" && (item.available || item.reason !== undefined),
    )
    .map((nodeType) => ({
      nodeType,
      reason: !nodeType.available
        ? (nodeType.reason ?? tr("automation.outline.unavailable"))
        : count >= AutomationGraph.MAX_ACTIONS_PER_SOURCE
          ? tr("automation.outline.unavailable.actions", {
              args: [String(AutomationGraph.MAX_ACTIONS_PER_SOURCE)],
            })
          : props.graph.nodes.length >= AutomationGraph.MAX_NODES
            ? tr("automation.outline.unavailable.nodes", {
                args: [String(AutomationGraph.MAX_NODES)],
              })
            : undefined,
    }));
  const order = graphs
    .order(props.graph)
    .filter((id) => graphs.node(props.graph, id)?.kind === "action");
  const config = (id: string, value: Record<string, unknown>) =>
    props.onChange((graph) => outline.setConfig(graph, id, value));
  const issue = (node: AutomationGraphNode) => {
    const list = props.issues[node.id];
    return list?.length ? (
      <Badge
        variant="tint"
        tone={
          list.some((item) => item.tone === "danger") ? "danger" : "warning"
        }
        className="max-w-56 truncate"
        title={list.map((item) => item.text).join("\n")}
        data-testid={`automation-outline-issue-${node.id}`}
      >
        {list[0].short}
      </Badge>
    ) : undefined;
  };
  const issueList = (node: AutomationGraphNode) => {
    const list = props.issues[node.id];
    if (!list?.length) return null;
    return (
      <ul
        className="flex flex-col gap-0.5 border-t px-4 py-2 text-sm"
        data-testid={`automation-outline-issues-${node.id}`}
      >
        {list.map((item) => (
          <li
            key={item.text}
            className={
              item.tone === "danger" ? "text-danger-text" : "text-warning-text"
            }
          >
            {item.short}
          </li>
        ))}
      </ul>
    );
  };
  const removeCondition = async () => {
    if (
      block.otherwise.length > 0 &&
      !(await dialog.confirm({
        title: tr("automation.outline.removeCondition.title"),
        description: tr("automation.outline.removeCondition.description"),
        confirmLabel: tr("automation.outline.removeCondition"),
        destructive: true,
      }))
    )
      return;
    props.onOpen(undefined);
    props.onChange((graph) => outline.removeCondition(graph, block.key));
  };
  const addAction =
    (side: AutomationOutlineSide) => (nodeType: AutomationCatalogNodeType) =>
      props.onAdd((graph) =>
        outline.addAction(graph, block.key, side, {
          type: nodeType.type,
          config: outline.config(nodeType),
        }),
      );

  const events_ = block.events.map((node) => labels.source(node));
  if (props.folded) {
    const first = block.sequences[0]?.[0] ?? block.otherwise[0]?.[0];
    return (
      <Card
        className="ring-foreground/15 gap-0 py-0 shadow-sm"
        data-testid={`automation-outline-block-${block.key}`}
      >
        <AutomationOutlineFolded
          event={events_.join(tr("automation.outline.or"))}
          eventIcon={AutomationOutlineIcons.of(block.events[0])}
          detail={
            block.condition ? (
              <AutomationOutlineCondition node={block.condition} plain />
            ) : (
              <AutomationOutlineSummary
                node={block.events[0]}
                names={props.names}
              />
            )
          }
          action={
            first
              ? tr(`automation.action.${first.type}`, { default: first.type })
              : undefined
          }
          actionIcon={first ? AutomationOutlineIcons.of(first) : undefined}
          actionSummary={
            first && (
              <AutomationOutlineSummary node={first} names={props.names} />
            )
          }
          more={Math.max(0, count - 1)}
          onUnfold={() => props.onFold(false)}
          testId={`automation-outline-folded-${block.key}`}
        />
      </Card>
    );
  }

  const sequenceRows = (
    list: AutomationGraphNode[][],
    tone: AutomationOutlineTone,
  ) =>
    list.map((sequence, index) => (
      <div key={sequence[0].id} className="divide-y">
        {sequence.map((node, step) => (
          <AutomationOutlineRow
            key={node.id}
            tone={tone}
            icon={AutomationOutlineIcons.of(node)}
            depth={step === 0 ? 0 : 1}
            lead={
              step === 0 ? (
                <span className="bg-foreground text-background grid size-5 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold">
                  {index + 1}
                </span>
              ) : (
                <CornerDownRight className="text-muted-foreground size-4 shrink-0" />
              )
            }
            title={tr(`automation.action.${node.type}`, { default: node.type })}
            summary={
              <AutomationOutlineSummary node={node} names={props.names} />
            }
            trailing={props.open === node.id ? undefined : issue(node)}
            open={props.open === node.id}
            onToggle={toggle(node.id)}
            testId={`automation-outline-row-${node.id}`}
          >
            {issueList(node)}
            <AutomationOutlineActionForm
              graph={props.graph}
              node={node}
              index={Math.max(0, order.indexOf(node.id))}
              catalog={catalog}
              actions={actions}
              disabled={props.disabled}
              onConfig={(value) => config(node.id, value)}
              onType={(nodeType) =>
                props.onChange((graph) =>
                  outline.setType(graph, node.id, nodeType),
                )
              }
              onStep={(nodeType) =>
                props.onAdd((graph) =>
                  outline.addStep(graph, node.id, {
                    type: nodeType.type,
                    config: outline.config(nodeType),
                  }),
                )
              }
              onRemove={() => {
                props.onOpen(undefined);
                props.onChange((graph) => outline.removeAction(graph, node.id));
              }}
            />
          </AutomationOutlineRow>
        ))}
      </div>
    ));

  return (
    <Card
      className="ring-foreground/15 gap-0 py-0 shadow-sm"
      data-testid={`automation-outline-block-${block.key}`}
    >
      <div className="divide-y">
        <AutomationOutlineSection
          tone="when"
          label={tr("automation.outline.when")}
          hint={
            block.events.length > 1 ? tr("automation.outline.anyOf") : undefined
          }
          testId="automation-outline-when"
          action={
            <span className="flex items-center gap-1">
              {!block.condition && (
                <Button
                  variant="minimal"
                  size="xs"
                  disabled={props.disabled}
                  data-testid={`automation-outline-add-condition-${block.key}`}
                  onClick={() =>
                    props.onAdd((graph) =>
                      outline.addCondition(graph, block.key, {
                        type: "compare",
                        config: { field: "", operator: "eq", value: "" },
                      }),
                    )
                  }
                >
                  <Filter />
                  {tr("automation.outline.addCondition")}
                </Button>
              )}
              {props.removable && (
                <>
                  <Button
                    variant="minimal"
                    size="icon-xs"
                    aria-label={tr("automation.outline.fold")}
                    onClick={() => props.onFold(true)}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="minimal"
                    size="icon-xs"
                    intent="danger"
                    aria-label={tr("automation.outline.removeBlock")}
                    disabled={props.disabled}
                    data-testid={`automation-outline-remove-block-${block.key}`}
                    onClick={() => {
                      props.onOpen(undefined);
                      props.onChange((graph) =>
                        outline.removeBlock(graph, block.key),
                      );
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </span>
          }
        >
          {block.events.map((node) => (
            <AutomationOutlineRow
              key={node.id}
              tone="when"
              icon={AutomationOutlineIcons.of(node)}
              title={labels.source(node)}
              summary={
                <AutomationOutlineSummary
                  node={
                    block.read && node.type === "schedule" ? block.read : node
                  }
                  names={props.names}
                />
              }
              trailing={
                <span className="flex items-center gap-2">
                  {props.open !== node.id &&
                    (issue(node) ??
                      (block.read ? issue(block.read) : undefined))}
                  {node.enabled === false && (
                    <span className="text-muted-foreground text-xs">
                      {tr("automation.outline.off")}
                    </span>
                  )}
                  <Switch
                    size="sm"
                    checked={node.enabled !== false}
                    disabled={props.disabled}
                    aria-label={tr("automation.outline.switch", {
                      args: [labels.source(node)],
                    })}
                    data-testid={`automation-outline-switch-${node.id}`}
                    onCheckedChange={(enabled) =>
                      props.onChange((graph) =>
                        outline.setEnabled(graph, node.id, enabled),
                      )
                    }
                  />
                </span>
              }
              open={props.open === node.id}
              onToggle={toggle(node.id)}
              testId={`automation-outline-row-${node.id}`}
            >
              {issueList(node)}
              {block.read && issueList(block.read)}
              <AutomationOutlineEventForm
                key={`${node.id}:${block.read?.type ?? ""}`}
                event={node}
                read={block.read}
                catalog={catalog}
                disabled={props.disabled}
                onConfig={config}
                onRead={(type) => {
                  const nodeType = catalog.nodeTypes.find(
                    (item) => item.kind === "read" && item.type === type,
                  );
                  if (nodeType && block.read)
                    props.onChange((graph) =>
                      outline.setType(graph, block.read!.id, nodeType),
                    );
                }}
                onRemove={() => {
                  props.onOpen(undefined);
                  props.onChange((graph) =>
                    outline.removeEvent(graph, node.id),
                  );
                }}
              />
            </AutomationOutlineRow>
          ))}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            {schedule ? (
              <span
                className="text-muted-foreground text-xs"
                data-testid="automation-outline-schedule-alone"
              >
                {tr("automation.outline.scheduleAlone")}
              </span>
            ) : count === 0 && !block.condition ? (
              <span className="text-muted-foreground text-xs">
                {tr("automation.outline.eventFirst")}
              </span>
            ) : (
              <AutomationOutlineEventMenu
                label={tr("automation.outline.addEvent")}
                events={events}
                disabled={props.disabled}
                testId={`automation-outline-add-event-${block.key}`}
                onPick={(nodeType) =>
                  props.onAdd((graph) =>
                    outline.addEvent(graph, block.key, {
                      type: nodeType.type,
                      config: outline.config(nodeType),
                    }),
                  )
                }
              />
            )}
          </div>
        </AutomationOutlineSection>
        {block.condition && (
          <AutomationOutlineSection
            tone="if"
            label={tr("automation.outline.onlyIf")}
            testId="automation-outline-if"
          >
            <AutomationOutlineRow
              tone="if"
              icon={Filter}
              title={<AutomationOutlineCondition node={block.condition} />}
              trailing={
                props.open === block.condition.id
                  ? undefined
                  : issue(block.condition)
              }
              open={props.open === block.condition.id}
              onToggle={toggle(block.condition.id)}
              testId={`automation-outline-row-${block.condition.id}`}
            >
              {issueList(block.condition)}
              <AutomationOutlineConditionForm
                graph={props.graph}
                node={block.condition}
                catalog={catalog}
                disabled={props.disabled}
                onConfig={(value) => config(block.condition!.id, value)}
                onRemove={() => void removeCondition()}
              />
            </AutomationOutlineRow>
          </AutomationOutlineSection>
        )}
        <AutomationOutlineSection
          tone="do"
          label={
            block.condition
              ? tr("automation.outline.then")
              : tr("automation.outline.do")
          }
          testId="automation-outline-then"
        >
          {sequenceRows(block.sequences, "do")}
          <div className="px-4 py-2">
            <AutomationOutlineActionMenu
              label={tr("automation.outline.addAction")}
              actions={actions}
              disabled={props.disabled}
              onPick={addAction("then")}
              testId={`automation-outline-add-action-${block.key}`}
            />
          </div>
        </AutomationOutlineSection>
        {block.condition && (
          <AutomationOutlineSection
            tone="else"
            label={tr("automation.outline.otherwise")}
            testId="automation-outline-otherwise"
          >
            {sequenceRows(block.otherwise, "else")}
            <div className="px-4 py-2">
              <AutomationOutlineActionMenu
                label={tr("automation.outline.addAction")}
                actions={actions}
                disabled={props.disabled}
                onPick={addAction("otherwise")}
                testId={`automation-outline-add-otherwise-${block.key}`}
              />
            </div>
          </AutomationOutlineSection>
        )}
      </div>
    </Card>
  );
};

export default AutomationOutlineBlockEditor;
