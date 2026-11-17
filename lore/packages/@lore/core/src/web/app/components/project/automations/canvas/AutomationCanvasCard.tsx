import { Badge } from "@alepha/ui";
import { Handle, Position } from "@xyflow/react";
import { useI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";

import type { AutomationGraphEdge } from "../../../../../../api/schemas/automationGraphEdgeSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import type {
  AutomationCanvasNodeData,
  AutomationCanvasOutcome,
} from "./AutomationCanvasMap.ts";

export interface AutomationCanvasCardProps {
  data: AutomationCanvasNodeData;
  selected?: boolean;
  /**
   * What the node is, in one line: the event, the comparison, the action.
   */
  title: ReactNode;
  /**
   * Beside the kind: a source's state dot.
   */
  status?: ReactNode;
  children?: ReactNode;
  /**
   * Whether a wire may arrive: every kind but a source.
   */
  target: boolean;
  /**
   * The ports a wire leaves from, top to bottom.
   */
  ports: AutomationGraphEdge["port"][];
}

/**
 * The frame every canvas node shares (#Q3810): its kind, what it is, the
 * handles its wires attach to, and on a run's page what it did.
 */
const AutomationCanvasCard = (props: AutomationCanvasCardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const node = props.data.node;
  const kinds: Record<string, string> = {
    source: tr("automation.node.source"),
    read: tr("automation.node.read"),
    condition: tr("automation.node.condition"),
    action: tr("automation.node.action"),
    transform: tr("automation.node.transform"),
  };
  const outcomes: Record<AutomationCanvasOutcome, string> = {
    ran: tr("automation.canvas.ran"),
    skipped: tr("automation.effect.skipped"),
    refused: tr("automation.effect.refused"),
    failed: tr("automation.effect.failed"),
    unknown: tr("automation.effect.unknown"),
    not_reached: tr("automation.canvas.notReached"),
    pending: tr("automation.effect.pending"),
  };
  const tones: Record<
    AutomationCanvasOutcome,
    "success" | "danger" | "warning" | "neutral"
  > = {
    ran: "success",
    skipped: "neutral",
    refused: "danger",
    failed: "danger",
    unknown: "warning",
    not_reached: "neutral",
    pending: "warning",
  };
  const borders: Record<AutomationCanvasOutcome, string> = {
    ran: "border-success",
    skipped: "border-dashed opacity-60",
    refused: "border-danger",
    failed: "border-danger",
    unknown: "border-warning",
    not_reached: "border-dashed opacity-60",
    pending: "border-warning",
  };
  const outcome = props.data.outcome;
  const issues = props.data.issues ?? [];
  const frame = issues.length
    ? "border-danger"
    : outcome
      ? borders[outcome]
      : props.data.painted
        ? "opacity-40"
        : "";
  const ports: Record<string, string> = {
    true: tr("automation.canvas.port.true"),
    false: tr("automation.canvas.port.false"),
  };
  return (
    <div
      className={`bg-card text-card-foreground relative flex w-56 flex-col gap-1 rounded-lg border p-3 text-xs shadow-sm ${
        props.selected ? "ring-primary ring-2" : ""
      } ${frame}`}
      data-testid={`automation-node-${node.id}`}
      data-kind={node.kind}
      data-outcome={outcome}
      data-invalid={issues.length > 0 || undefined}
    >
      {props.target && (
        <Handle
          type="target"
          id="in"
          position={Position.Left}
          isConnectable={!!props.data.onAdd}
        />
      )}
      <div className="text-muted-foreground flex items-center justify-between gap-2">
        <span className="font-medium tracking-wide uppercase">
          {kinds[node.kind] ?? node.kind}
        </span>
        {props.status}
      </div>
      <div className="text-sm font-medium break-words">{props.title}</div>
      {props.children}
      {outcome && (
        <Badge
          variant="tint"
          tone={tones[outcome]}
          className="self-start"
          data-testid={`automation-node-${node.id}-outcome`}
        >
          {outcomes[outcome]}
          {props.data.ports?.length
            ? ` → ${props.data.ports.map((port) => ports[port]).join(", ")}`
            : ""}
        </Badge>
      )}
      {issues.length > 0 && (
        <ul
          className="text-danger-text flex flex-col gap-0.5"
          data-testid={`automation-node-${node.id}-issues`}
        >
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {props.data.onAdd &&
        props.ports.map((port, index) => (
          <button
            key={`add-${port}`}
            type="button"
            className="nodrag nopan bg-card hover:bg-muted text-muted-foreground absolute -end-9 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border text-sm"
            style={{
              top: `${((index + 1) * 100) / (props.ports.length + 1)}%`,
            }}
            aria-label={
              port === "out"
                ? tr("automation.canvas.addAfter", { args: [node.id] })
                : tr("automation.canvas.addAfterPort", {
                    args: [node.id, ports[port]],
                  })
            }
            data-testid={`automation-node-${node.id}-add-${port}`}
            onClick={(event) => {
              event.stopPropagation();
              props.data.onAdd?.(port);
            }}
          >
            +
          </button>
        ))}
      {props.ports.map((port, index) => (
        <Handle
          key={port}
          type="source"
          id={port}
          position={Position.Right}
          isConnectable={!!props.data.onAdd}
          style={
            props.ports.length > 1
              ? { top: `${((index + 1) * 100) / (props.ports.length + 1)}%` }
              : undefined
          }
        />
      ))}
    </div>
  );
};

export default AutomationCanvasCard;
