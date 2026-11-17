import {
  Badge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationResourceSource } from "../../../../../../api/schemas/automationResourceSourceSchema.ts";
import { AutomationTemplateTokens } from "../../../../../../api/schemas/AutomationTemplateTokens.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";
import type { AutomationCanvasNames } from "./AutomationCanvasMap.ts";

export interface AutomationNodePanelProps {
  /**
   * The node shown; absent, the panel is closed.
   */
  node?: AutomationGraphNode;
  source?: AutomationResourceSource;
  names?: AutomationCanvasNames;
  onClose: () => void;
}

/**
 * A canvas node's full configuration, read-only (#Q3810): every field as
 * stored, message text whole, and the placeholders it fills in.
 */
const AutomationNodePanel = (props: AutomationNodePanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const node = props.node;
  const kinds: Record<string, string> = {
    source: tr("automation.node.source"),
    read: tr("automation.node.read"),
    condition: tr("automation.node.condition"),
    action: tr("automation.node.action"),
    transform: tr("automation.node.transform"),
  };
  const tokens = node
    ? [...new Set(new AutomationTemplateTokens().inValue(node.config))]
    : [];
  const named = (key: string, value: unknown) => {
    if (typeof value !== "string") return undefined;
    if (key === "recipient") return props.names?.members[value];
    if (key === "folio") return props.names?.folios[value];
    return undefined;
  };
  return (
    <Sheet
      open={!!node}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetContent
        side="end"
        className="flex w-full flex-col gap-0 overflow-y-auto data-[side=end]:sm:max-w-[32rem]"
        data-testid="automation-node-panel"
      >
        {node && (
          <>
            <SheetHeader>
              <SheetTitle>
                {kinds[node.kind] ?? node.kind}:{" "}
                {node.kind === "source"
                  ? labels.source(node)
                  : node.kind === "action"
                    ? tr(`automation.action.${node.type}`, {
                        default: node.type,
                      })
                    : node.kind === "read"
                      ? tr(`automation.source.${node.type}`, {
                          default: node.type,
                        })
                      : node.type}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {node.id}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 p-4 text-sm">
              {props.source && (
                <p>
                  {!props.source.enabled
                    ? tr("automation.canvas.source.off")
                    : props.source.health === "broken"
                      ? tr("automation.state.broken")
                      : tr("automation.state.active")}
                  {props.source.reason && (
                    <span className="text-muted-foreground">
                      {" "}
                      {props.source.reason}
                    </span>
                  )}
                </p>
              )}
              <dl className="flex flex-col gap-3">
                {Object.entries(node.config).map(([key, value]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <dt className="text-muted-foreground text-xs font-medium">
                      {key}
                    </dt>
                    <dd className="break-words whitespace-pre-wrap">
                      {key === "channels" && Array.isArray(value) ? (
                        value
                          .map((channel) =>
                            typeof channel !== "string"
                              ? JSON.stringify(channel)
                              : (props.names?.channels[channel] ??
                                tr(`automation.channel.${channel}`, {
                                  default: channel,
                                })),
                          )
                          .join(", ")
                      ) : typeof value === "string" ? (
                        <>
                          {named(key, value) && (
                            <span className="me-1">{named(key, value)}</span>
                          )}
                          <span
                            className={
                              named(key, value)
                                ? "text-muted-foreground font-mono text-xs"
                                : undefined
                            }
                          >
                            {value}
                          </span>
                        </>
                      ) : (
                        <code className="font-mono text-xs">
                          {JSON.stringify(value, null, 2)}
                        </code>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {tokens.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">
                    {tr("automation.canvas.placeholders")}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {tokens.map((token) => (
                      <Badge
                        key={token}
                        variant="outline"
                        className="font-mono"
                      >
                        {`{{${token}}}`}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default AutomationNodePanel;
