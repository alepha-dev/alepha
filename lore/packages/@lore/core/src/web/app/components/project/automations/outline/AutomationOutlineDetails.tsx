import { useI18n } from "alepha/react/i18n";

import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationOutlineTemplate from "./AutomationOutlineTemplate.tsx";
import type { AutomationOutlineNames } from "./useAutomationOutlineNames.ts";

export interface AutomationOutlineDetailsProps {
  node: AutomationGraphNode;
  names?: AutomationOutlineNames;
}

/**
 * A row opened read-only (#Q3847): its whole configuration, every value as
 * stored, message text whole, placeholders as chips, ids named where the
 * page knows the name. No field: the editor is behind Edit.
 */
const AutomationOutlineDetails = (props: AutomationOutlineDetailsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const named = (key: string, value: unknown) => {
    if (typeof value !== "string") return undefined;
    if (key === "recipient") return props.names?.members[value];
    if (key === "folio") return props.names?.folios[value];
    return undefined;
  };
  const config = props.node.config as Record<string, unknown>;
  const flat: Array<[string, unknown]> =
    props.node.kind === "read"
      ? Object.entries((config.filters ?? {}) as Record<string, unknown>)
      : Object.entries(config);
  const entries = flat.filter(
    ([, value]) => value !== undefined && value !== "",
  );
  return (
    <dl
      className="bg-background/60 flex flex-col gap-3 border-t px-4 py-3 text-sm"
      style={{ paddingInlineStart: "4.25rem" }}
      data-testid="automation-outline-details"
    >
      {entries.length === 0 && (
        <p className="text-muted-foreground">
          {tr("automation.outline.nothingSet")}
        </p>
      )}
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs font-medium">
            {tr(`automation.setup.${key}`, { default: key })}
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
            ) : key === "operator" && typeof value === "string" ? (
              tr(`automation.operator.${value}`, { default: value })
            ) : typeof value === "string" ? (
              (named(key, value) ?? <AutomationOutlineTemplate text={value} />)
            ) : (
              <code className="font-mono text-xs">{JSON.stringify(value)}</code>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
};

export default AutomationOutlineDetails;
