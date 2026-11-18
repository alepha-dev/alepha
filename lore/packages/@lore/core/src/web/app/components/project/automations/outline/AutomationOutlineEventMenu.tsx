import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Clock, Package, Plus, Zap } from "lucide-react";

import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { automationCatalogPresetSchema } from "../../../../../../api/schemas/automationCatalogPresetSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";

type AutomationCatalogPreset = ReturnType<
  typeof automationCatalogPresetSchema.parse
>;

export interface AutomationOutlineEventMenuProps {
  label: string;
  prominent?: boolean;
  /**
   * The events and the schedule, each with why it cannot be picked here.
   */
  events: Array<{ nodeType: AutomationCatalogNodeType; reason?: string }>;
  /**
   * Presets offered as a whole block; absent, none is.
   */
  presets?: Array<{ preset: AutomationCatalogPreset; reason?: string }>;
  disabled?: boolean;
  onPick: (nodeType: AutomationCatalogNodeType) => void;
  onPickPreset?: (preset: AutomationCatalogPreset) => void;
  testId?: string;
}

/**
 * What can start a block (#Q3848): the events, grouped by what they are
 * about, then a schedule, then the presets, an unavailable entry saying
 * why.
 */
const AutomationOutlineEventMenu = (props: AutomationOutlineEventMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const groups: Record<string, string> = {
    feedback: tr("automation.outline.group.feedback"),
    quest: tr("automation.outline.group.quests"),
    epic: tr("automation.outline.group.epics"),
    release: tr("automation.outline.group.releases"),
    deploy: tr("automation.outline.group.deploys"),
    monitor: tr("automation.outline.group.monitors"),
    host: tr("automation.outline.group.hosts"),
  };
  const events = props.events.filter(
    (item) => item.nodeType.type !== "schedule",
  );
  const schedule = props.events.find(
    (item) => item.nodeType.type === "schedule",
  );
  const prefixes = [
    ...new Set(events.map((item) => item.nodeType.type.split(".")[0])),
  ];
  const item = (
    entry: { nodeType: AutomationCatalogNodeType; reason?: string },
    label: string,
    icon: typeof Zap,
  ) => {
    const Icon = icon;
    return (
      <DropdownMenuItem
        key={entry.nodeType.type}
        disabled={!!entry.reason}
        onClick={() => props.onPick(entry.nodeType)}
        data-testid={`automation-outline-event-${entry.nodeType.type}`}
      >
        <Icon />
        <span className="flex flex-col">
          <span>{label}</span>
          {entry.reason && (
            <span className="text-muted-foreground text-xs">
              {entry.reason}
            </span>
          )}
        </span>
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={props.disabled}
        render={
          props.prominent ? (
            <Button data-testid={props.testId} />
          ) : (
            <Button variant="minimal" size="sm" data-testid={props.testId} />
          )
        }
      >
        <Plus />
        {props.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-72">
        {prefixes.map((prefix) => (
          <DropdownMenuGroup key={prefix}>
            <DropdownMenuLabel>{groups[prefix] ?? prefix}</DropdownMenuLabel>
            {events
              .filter((entry) => entry.nodeType.type.startsWith(`${prefix}.`))
              .map((entry) =>
                item(
                  entry,
                  labels.source({
                    id: "x",
                    kind: "source",
                    type: entry.nodeType.type,
                    config: {},
                  }),
                  Zap,
                ),
              )}
          </DropdownMenuGroup>
        ))}
        {schedule && (
          <>
            <DropdownMenuSeparator />
            {item(schedule, tr("automation.outline.schedule"), Clock)}
          </>
        )}
        {props.presets && props.presets.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {tr("automation.outline.group.presets")}
              </DropdownMenuLabel>
              {props.presets.map((entry) => (
                <DropdownMenuItem
                  key={entry.preset.key}
                  disabled={!!entry.reason}
                  onClick={() => props.onPickPreset?.(entry.preset)}
                  data-testid={`automation-outline-preset-${entry.preset.key}`}
                >
                  <Package />
                  <span className="flex flex-col">
                    <span>
                      {tr(`automation.preset.${entry.preset.key}.title`, {
                        default: entry.preset.title,
                      })}
                    </span>
                    {entry.reason && (
                      <span className="text-muted-foreground text-xs">
                        {entry.reason}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AutomationOutlineEventMenu;
