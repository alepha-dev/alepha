import { Badge } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import { AutomationGraph } from "../../../../../../api/schemas/AutomationGraph.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationOutlineTemplate from "./AutomationOutlineTemplate.tsx";
import type { AutomationOutlineNames } from "./useAutomationOutlineNames.ts";

export interface AutomationOutlineSummaryProps {
  node: AutomationGraphNode;
  names?: AutomationOutlineNames;
}

/**
 * A row's one line (#Q3847): an event's filters, what a read selects, an
 * action's target, its channels and its text, placeholders as chips.
 */
const AutomationOutlineSummary = (props: AutomationOutlineSummaryProps) => {
  const { tr } = useI18n<I18n, "en">();
  const node = props.node;
  const config = node.config as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string"
      ? value
      : value === undefined || value === null
        ? ""
        : JSON.stringify(value);
  if (node.kind === "source") {
    if (node.type === "schedule") return null;
    const filters = Object.entries(config).filter(
      ([, value]) => value !== undefined && value !== "",
    );
    if (!filters.length) return null;
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {filters.map(([key, value]) => (
          <Badge key={key} variant="outline">
            {tr(`automation.setup.${key}`, { default: key })}: {text(value)}
          </Badge>
        ))}
      </span>
    );
  }
  if (node.kind === "read") {
    const filters = Object.entries(
      (config.filters ?? {}) as Record<string, unknown>,
    ).filter(([, value]) => value !== undefined && value !== "");
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span>
          {tr(`automation.source.${node.type}`, { default: node.type })}
        </span>
        {filters.map(([key, value]) => (
          <Badge key={key} variant="outline">
            {tr(`automation.setup.${key}`, { default: key })}: {text(value)}
          </Badge>
        ))}
      </span>
    );
  }
  if (node.kind !== "action") return null;
  const target =
    node.type === "notify"
      ? config.audience
        ? tr("automation.audience.roster")
        : props.names?.members[text(config.recipient)] || text(config.recipient)
      : node.type === "appendFolio"
        ? props.names?.folios[text(config.folio)] || text(config.folio)
        : node.type === "createQuest"
          ? text(config.title)
          : node.type === "assignRelease"
            ? text(config.release)
            : node.type === "addTag"
              ? text(config.tag)
              : "";
  const channels = new AutomationGraph().channels(node);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {target && (
        <span className="min-w-0 truncate">
          <AutomationOutlineTemplate text={target} line />
        </span>
      )}
      {channels.map((channel) => (
        <Badge key={channel} variant="secondary">
          {props.names?.channels[channel] ??
            tr(`automation.channel.${channel}`, { default: channel })}
        </Badge>
      ))}
      {node.type === "addTag" && config.quest !== undefined && (
        <span className="min-w-0 truncate">
          <AutomationOutlineTemplate text={text(config.quest)} line />
        </span>
      )}
    </span>
  );
};

export default AutomationOutlineSummary;
