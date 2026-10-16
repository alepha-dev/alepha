import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useQuery } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { isHttpError } from "alepha/server";
import { useEffect, useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { automationCatalogSchema } from "../../../../../api/schemas/automationCatalogSchema.ts";
import { automationEditorHeaderSchema } from "../../../../../api/schemas/automationEditorHeaderSchema.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import {
  automationRuleSchema,
  type AutomationRule,
} from "../../../../../api/schemas/automationRuleSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationActionEditor from "./AutomationActionEditor.tsx";
import AutomationValueControl from "./AutomationValueControl.tsx";

export interface AutomationRuleEditorProps {
  resource: AutomationResource;
  catalogue: ReturnType<typeof automationCatalogSchema.parse>;
  onSaved: (rule: AutomationResource) => void;
  onCancel: () => void;
  onConflict: () => void;
  onBusyChange: (busy: boolean) => void;
}

const AutomationRuleEditor = (props: AutomationRuleEditorProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<AutomationController>();
  const [draft, setDraft] = useState<AutomationRule>(() =>
    structuredClone(props.resource.rule!),
  );
  const variablePage = useQuery(
    {
      key: ["automation-variables", props.resource.projectId, 0],
      handler: ({ signal }) =>
        api.listAutomationVariables(
          {
            params: { projectId: props.resource.projectId },
            query: { offset: 0, limit: 50 },
          },
          { request: { signal } },
        ),
    },
    [props.resource.projectId],
  );
  const variables =
    variablePage.data?.items ?? props.catalogue.variables.slice(0, 50);
  const [title, setTitle] = useState(props.resource.title);
  const source = props.catalogue.entries.find(
    (entry) =>
      entry.key ===
      (draft.trigger.kind === "event"
        ? draft.trigger.event
        : draft.select?.key),
  );
  const bindings = [
    ...Object.entries(source?.fields ?? {}).map(([key, kind]) => ({
      key,
      kind,
    })),
    ...variables
      .filter((variable) => variable.available)
      .map(({ key, kind }) => ({ key, kind })),
  ];
  const save = useAction<[], boolean>(
    {
      handler: async () => {
        try {
          const saved = await api.updateAutomation({
            params: {
              projectId: props.resource.projectId,
              id: props.resource.id,
            },
            body: {
              title,
              rule: automationRuleSchema.parse(draft),
              expectedRevision: props.resource.revision,
            },
          });
          props.onSaved(saved);
          return true;
        } catch (error) {
          // Only a revision conflict offers the reload; any other refusal is
          // the toaster's, and the draft stays as typed either way.
          if (isHttpError(error, 409)) props.onConflict();
          throw error;
        }
      },
    },
    [api, props.resource, draft, title, props.onSaved, props.onConflict],
  );
  useEffect(() => {
    props.onBusyChange(save.loading);
    return () => props.onBusyChange(false);
  }, [save.loading, props.onBusyChange]);
  const header = useForm({
    schema: automationEditorHeaderSchema,
    handler: () => undefined,
    initialValues: {
      title: props.resource.title,
      trigger: draft.trigger.kind,
      source: source?.key ?? "",
      ...(draft.guard ? { guard: draft.guard.field } : {}),
      operator: draft.guard?.operator ?? "eq",
    },
    onChange: (name, value) => {
      if (name === "title") setTitle(String(value));
      if (name === "trigger") {
        const next = props.catalogue.entries.find(
          (entry) =>
            entry.available &&
            (value === "event"
              ? entry.type === "event"
              : ["selection", "metric"].includes(entry.type)),
        );
        if (next) {
          header.input.source.set(next.key);
          setDraft((rule) => ({
            ...rule,
            trigger:
              value === "event"
                ? {
                    kind: "event",
                    event: next.key as Extract<
                      AutomationRule["trigger"],
                      { kind: "event" }
                    >["event"],
                  }
                : { kind: "schedule", cron: "0 0 * * *" },
            select:
              value === "event"
                ? null
                : {
                    key: next.key,
                    kind: next.result as "rows" | "scalar" | "collection",
                    filters: {},
                  },
            guard: null,
          }));
        }
      }
      if (name === "source") {
        header.input.guard.set(undefined);
        header.input.operator.set("eq");
        const next = props.catalogue.entries.find(
          (entry) => entry.key === value,
        );
        if (next)
          setDraft((rule) => ({
            ...rule,
            trigger:
              rule.trigger.kind === "event"
                ? {
                    kind: "event",
                    event: next.key as Extract<
                      AutomationRule["trigger"],
                      { kind: "event" }
                    >["event"],
                  }
                : rule.trigger,
            select:
              rule.trigger.kind === "event"
                ? null
                : {
                    key: next.key,
                    kind: next.result as "rows" | "scalar" | "collection",
                    filters: {},
                  },
            guard: null,
          }));
      }
      if (name === "guard")
        setDraft((rule) => ({
          ...rule,
          guard: value
            ? {
                field: String(value),
                operator: "eq",
                value: source?.fields[String(value)] === "number" ? 0 : "",
              }
            : null,
        }));
      if (name === "operator")
        setDraft((rule) => ({
          ...rule,
          guard: rule.guard
            ? {
                ...rule.guard,
                operator: value as NonNullable<
                  AutomationRule["guard"]
                >["operator"],
              }
            : null,
        }));
    },
  });
  const actionKinds = props.catalogue.entries.filter(
    (entry) => entry.type === "action" && entry.available,
  );
  const changeAction = (index: number, key: string) => {
    const entry = actionKinds.find((item) => item.key === key);
    if (!entry) return;
    const action = Object.fromEntries([
      ["kind", key],
      ...Object.entries(entry.slots).map(([name, slot]) => [
        name,
        slot.default ??
          (slot.kind === "number" || slot.kind === "release"
            ? 0
            : slot.kind === "boolean"
              ? false
              : name === "category"
                ? "automations"
                : ""),
      ]),
    ]) as AutomationRule["actions"][number];
    setDraft((rule) => ({
      ...rule,
      actions: rule.actions.map((item, position) =>
        position === index ? action : item,
      ),
    }));
  };
  return (
    <section
      className="flex flex-col gap-5"
      aria-label={tr("automation.editor.title")}
    >
      <p className="text-muted-foreground text-sm">
        {tr("automation.editor.author", {
          args: [props.resource.authorName || props.resource.authorUserId],
        })}
      </p>
      <Control
        input={header.input.title}
        label={tr("automation.column.name")}
        disabled={save.loading}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-medium">
          {tr("automation.editor.trigger")}
        </legend>
        <Control
          input={header.input.trigger}
          label={tr("automation.column.trigger")}
          select
          items={[
            { value: "event", label: tr("automation.editor.event") },
            { value: "schedule", label: tr("automation.editor.schedule") },
          ]}
          disabled={save.loading}
        />
        <Control
          input={header.input.source}
          label={tr("automation.editor.source")}
          select
          items={props.catalogue.entries
            .filter(
              (entry) =>
                entry.available &&
                (draft.trigger.kind === "event"
                  ? entry.type === "event"
                  : ["selection", "metric"].includes(entry.type)),
            )
            .map((entry) => ({
              value: entry.key,
              label: tr(`automation.source.${entry.key}` as never, {
                default: entry.key,
              }),
            }))}
          disabled={save.loading}
        />
        {draft.trigger.kind === "schedule" && (
          <AutomationValueControl
            label={tr("automation.editor.cron")}
            slot={{ kind: "text", required: true, max: 128 }}
            value={draft.trigger.cron}
            bindings={variables.filter((item) => item.available)}
            disabled={save.loading}
            onChange={(value) =>
              setDraft((rule) => ({
                ...rule,
                trigger: {
                  kind: "schedule",
                  cron: typeof value === "string" ? value : "",
                },
              }))
            }
          />
        )}
        {draft.trigger.kind === "event" &&
          Object.entries(source?.slots ?? {}).map(([key, slot]) => (
            <AutomationValueControl
              key={`${source?.key}:${key}`}
              label={tr(`automation.setup.${key}` as never, { default: key })}
              slot={slot}
              value={"app" in draft.trigger ? draft.trigger.app : undefined}
              bindings={variables.filter((item) => item.available)}
              disabled={save.loading}
              onChange={(value) =>
                setDraft((rule) => ({
                  ...rule,
                  trigger: {
                    ...rule.trigger,
                    ...(value
                      ? { app: typeof value === "string" ? value : "" }
                      : { app: undefined }),
                  },
                }))
              }
            />
          ))}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-medium">
          {tr("automation.editor.select")}
        </legend>
        <p className="text-muted-foreground text-sm">
          {tr(
            draft.trigger.kind === "event"
              ? "automation.editor.eventSelect"
              : draft.select?.kind === "collection"
                ? "automation.editor.collection"
                : draft.select?.kind === "scalar"
                  ? "automation.editor.scalar"
                  : "automation.editor.rows",
          )}
        </p>
        {draft.select &&
          Object.entries(source?.slots ?? {}).map(([key, slot]) => (
            <AutomationValueControl
              key={`${source?.key}:${key}`}
              label={tr(`automation.setup.${key}` as never, { default: key })}
              slot={slot}
              value={draft.select?.filters[key]}
              bindings={variables.filter((item) => item.available)}
              disabled={save.loading}
              onChange={(value) =>
                setDraft((rule) => {
                  const filters = { ...rule.select!.filters };
                  if (value === undefined) delete filters[key];
                  else filters[key] = value as never;
                  return { ...rule, select: { ...rule.select!, filters } };
                })
              }
            />
          ))}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-medium">
          {tr("automation.editor.guard")}
        </legend>
        <Control
          input={header.input.guard}
          label={tr("automation.editor.field")}
          select
          clearable
          clearLabel={tr("automation.editor.always")}
          items={Object.keys(source?.fields ?? {}).map((value) => ({
            value,
            label: value,
          }))}
          disabled={save.loading}
        />
        {draft.guard && (
          <>
            <Control
              input={header.input.operator}
              label={tr("automation.editor.operator")}
              select
              items={(source?.fields[draft.guard.field] === "number"
                ? [
                    "eq",
                    "ne",
                    "lt",
                    "lte",
                    "gt",
                    "gte",
                    ...(source?.operators ?? []),
                  ]
                : ["eq", "ne"]
              )
                .filter((value, index, all) => all.indexOf(value) === index)
                .map((value) => ({
                  value,
                  label: tr(`automation.operator.${value}` as never, {
                    default: value,
                  }),
                }))}
              disabled={save.loading}
            />
            <AutomationValueControl
              key={draft.guard.field}
              label={tr("automation.editor.value")}
              slot={{
                kind: source?.fields[draft.guard.field] ?? "text",
                required: true,
              }}
              value={draft.guard.value}
              bindings={bindings}
              disabled={save.loading}
              onChange={(value) =>
                setDraft((rule) => ({
                  ...rule,
                  guard: { ...rule.guard!, value: value as never },
                }))
              }
            />
          </>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-medium">
          {tr("automation.editor.actions")}
        </legend>
        {draft.actions.map((action, index) => (
          <AutomationActionEditor
            key={index}
            index={index}
            allowAudience={
              draft.trigger.kind === "event" &&
              draft.trigger.event === "release.published"
            }
            action={action}
            entries={actionKinds}
            bindings={bindings}
            channels={props.catalogue.channels
              .filter((item) => item.available)
              .map((item) => item.key)}
            disabled={save.loading}
            onKind={(key) => changeAction(index, key)}
            onChange={(key, value) =>
              setDraft((rule) => ({
                ...rule,
                actions: rule.actions.map((item, position) =>
                  position === index
                    ? (Object.fromEntries(
                        Object.entries({
                          ...item,
                          [key]: value,
                          ...(key === "audience" && value
                            ? { recipient: undefined, category: "releases" }
                            : {}),
                        }).filter(([, field]) => field !== undefined),
                      ) as AutomationRule["actions"][number])
                    : item,
                ),
              }))
            }
            onRemove={() =>
              setDraft((rule) => ({
                ...rule,
                actions: rule.actions.filter(
                  (_, position) => position !== index,
                ),
              }))
            }
            removable={draft.actions.length > 1}
          />
        ))}
        <Button
          variant="outlined"
          disabled={save.loading || draft.actions.length >= 5}
          onClick={() =>
            setDraft((rule) => ({
              ...rule,
              actions: [
                ...rule.actions,
                {
                  kind: "notify",
                  recipient: "",
                  channel: "inbox",
                  title: "",
                  text: "",
                  category: "automations",
                },
              ],
            }))
          }
        >
          {tr("automation.editor.addAction")}
        </Button>
      </fieldset>
      <div className="flex gap-2">
        <Button
          intent="primary"
          loading={save.loading}
          disabled={save.loading || !title.trim()}
          onClick={() => void save.run()}
        >
          {tr("automation.editor.save")}
        </Button>
        <Button
          variant="minimal"
          disabled={save.loading}
          onClick={props.onCancel}
        >
          {tr("automation.setup.cancel")}
        </Button>
      </div>
    </section>
  );
};
export default AutomationRuleEditor;
