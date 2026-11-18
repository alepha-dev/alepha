import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";

import type { automationCatalogSchema } from "../../../../../../api/schemas/automationCatalogSchema.ts";
import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import { automationReadFormSchema } from "../../../../../../api/schemas/automationReadFormSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationValueControl from "../AutomationValueControl.tsx";

export interface AutomationOutlineEventFormProps {
  event: AutomationGraphNode;
  /**
   * A schedule's read, edited in the same row.
   */
  read?: AutomationGraphNode;
  catalog: ReturnType<typeof automationCatalogSchema.parse>;
  disabled: boolean;
  onConfig: (node: string, config: Record<string, unknown>) => void;
  /**
   * Another read for the schedule.
   */
  onRead: (type: string) => void;
  onRemove: () => void;
}

/**
 * An event's row opened in the editor (#Q3848): its filters (the app,
 * monitor and host pickers); a schedule's cron and what it reads, with
 * that read's filters, in one row.
 */
const AutomationOutlineEventForm = (props: AutomationOutlineEventFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const catalog = props.catalog;
  const variables = catalog.variables
    .filter((item) => item.available)
    .map(({ key, kind }) => ({ key, kind }));
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
  const event = props.event;
  const entry = catalog.entries.find((item) => item.key === event.type);
  const reads = catalog.nodeTypes.filter(
    (item) =>
      item.kind === "read" &&
      (item.available || item.type === props.read?.type),
  );
  const readForm = useForm({
    schema: automationReadFormSchema,
    handler: () => undefined,
    initialValues: { read: props.read?.type ?? "" },
    onChange: (_name, value) => props.onRead(String(value)),
  });
  const read = props.read;
  const readEntry = read
    ? catalog.entries.find((item) => item.key === read.type)
    : undefined;
  const readFilters = (read?.config.filters ?? {}) as Record<string, unknown>;
  return (
    <div
      className="bg-background/60 flex flex-col gap-3 border-t px-4 py-3"
      data-testid="automation-outline-event-form"
    >
      {event.type === "schedule" ? (
        <AutomationValueControl
          label={tr("automation.outline.cron")}
          slot={{ kind: "text", required: true, max: 128 }}
          value={event.config.cron}
          bindings={variables}
          disabled={props.disabled}
          onChange={(value) =>
            props.onConfig(event.id, {
              cron: typeof value === "string" ? value : "",
            })
          }
        />
      ) : (
        Object.entries(entry?.slots ?? {}).map(([key, slot]) => (
          <AutomationValueControl
            key={`${event.id}:${key}`}
            label={tr(`automation.setup.${key}`, { default: key })}
            slot={slot}
            value={event.config[key]}
            bindings={variables}
            disabled={props.disabled}
            onChange={(value) =>
              props.onConfig(event.id, filters(event.config, key, value))
            }
          />
        ))
      )}
      {read && (
        <>
          <Control
            input={readForm.input.read}
            label={tr("automation.outline.reads")}
            select
            items={reads.map((item) => ({
              value: item.type,
              label: tr(`automation.source.${item.type}`, {
                default: item.type,
              }),
            }))}
            disabled={props.disabled}
          />
          {Object.entries(readEntry?.slots ?? {}).map(([key, slot]) => (
            <AutomationValueControl
              key={`${read.id}:${read.type}:${key}`}
              label={tr(`automation.setup.${key}`, { default: key })}
              slot={slot}
              value={readFilters[key]}
              bindings={variables}
              disabled={props.disabled}
              onChange={(value) =>
                props.onConfig(read.id, {
                  ...read.config,
                  filters: filters(readFilters, key, value),
                })
              }
            />
          ))}
        </>
      )}
      <Button
        variant="minimal"
        intent="danger"
        size="sm"
        className="self-start"
        disabled={props.disabled}
        onClick={props.onRemove}
        data-testid={`automation-outline-remove-${event.id}`}
      >
        <Trash2 className="size-4" />
        {tr("automation.outline.removeEvent")}
      </Button>
    </div>
  );
};

export default AutomationOutlineEventForm;
