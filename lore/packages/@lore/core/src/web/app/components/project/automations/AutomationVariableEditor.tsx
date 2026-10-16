import { Button, useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { automationVariableEditorSchema } from "../../../../../api/schemas/automationVariableEditorSchema.ts";
import type { AutomationVariableResource } from "../../../../../api/schemas/automationVariableResourceSchema.ts";
import { automationVariableValueSchema } from "../../../../../api/schemas/automationVariableValueSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationValueControl from "./AutomationValueControl.tsx";

export interface AutomationVariableEditorProps {
  variable?: AutomationVariableResource;
  channels: string[];
  onSaved: (deleted: boolean) => void;
  canManage: boolean;
  onBusyChange: (busy: boolean) => void;
}
const AutomationVariableEditor = (props: AutomationVariableEditorProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const dialog = useDialog();
  const router = useRouter<AutomationRouter>();
  const { tr } = useI18n<I18n, "en">();
  const kindLabels = {
    text: tr("automation.variables.kind.text"),
    number: tr("automation.variables.kind.number"),
    member: tr("automation.variables.kind.member"),
    folio: tr("automation.variables.kind.folio"),
    release: tr("automation.variables.kind.release"),
    channel: tr("automation.variables.kind.channel"),
  };

  const [variable, setVariable] = useState(props.variable);
  const [value, setValue] = useState<unknown>(variable?.value?.value ?? "");
  const [offset, setOffset] = useState(0);
  const [affected, setAffected] = useState<
    { id: string; title: string; requiresApproval: boolean }[]
  >([]);
  const form = useForm({
    schema: automationVariableEditorSchema,
    handler: () => undefined,
    initialValues: { key: variable?.key ?? "", kind: variable?.kind ?? "text" },
    onChange: (name, next) => {
      if (name === "kind")
        setValue(next === "number" || next === "release" ? 0 : "");
    },
  });
  const values = useFormValues(form);
  const dependents = useQuery(
    {
      key: [
        "automation-variable-dependents",
        project?.id,
        variable?.key,
        offset,
      ],
      enabled: !!project && !!variable && props.canManage,
      handler: ({ signal }) =>
        api.getAutomationVariableDependents(
          {
            params: { projectId: project!.id, key: variable!.key },
            query: { offset, limit: 50 },
          },
          { request: { signal } },
        ),
    },
    [project?.id, variable?.key, offset, props.canManage],
  );
  const save = useAction<[], boolean>(
    {
      handler: async () => {
        if (!project || !props.canManage) return false;
        const parsed = automationVariableEditorSchema.parse(form.currentValues);
        const native = automationVariableValueSchema.parse({
          kind: parsed.kind,
          value,
        });
        if (
          variable &&
          !(await dialog.confirm({
            title: tr("automation.variables.confirmTitle"),
            description: tr("automation.variables.warning"),
            confirmLabel: tr("automation.editor.save"),
          }))
        )
          return false;
        const result = await api.setAutomationVariable({
          params: { projectId: project.id, key: parsed.key },
          body: {
            value: native,
            ...(variable ? { id: variable.id, version: variable.version } : {}),
          },
        });
        setAffected(result.affected);
        setVariable(result.variable);
        queries.invalidate(["automation-variables", project.id]);
        queries.invalidate(["automation-catalog", project.id]);
        queries.invalidate(["automation-variable-dependents", project.id]);
        queries.invalidate(["automations", project.id]);
        props.onSaved(false);
        return true;
      },
    },
    [
      api,
      project,
      variable,
      props.canManage,
      props.onSaved,
      form,
      value,
      queries,
      dialog,
      tr,
    ],
  );
  const remove = useAction<[], boolean>(
    {
      handler: async () => {
        if (!project || !variable || !props.canManage) return false;
        if (
          !(await dialog.confirm({
            title: tr("automation.variables.deleteTitle"),
            description: tr("automation.variables.deleteDescription"),
            destructive: true,
            confirmLabel: tr("automation.delete"),
          }))
        )
          return false;
        await api.deleteAutomationVariable({
          params: { projectId: project.id, key: variable.key },
          body: { id: variable.id, version: variable.version },
        });
        queries.invalidate(["automation-variables", project.id]);
        queries.invalidate(["automation-catalog", project.id]);
        props.onSaved(true);
        return true;
      },
    },
    [
      api,
      project,
      variable,
      props.canManage,
      props.onSaved,
      queries,
      dialog,
      tr,
    ],
  );
  const busy = save.loading || remove.loading;
  useEffect(() => {
    props.onBusyChange(busy);
    return () => props.onBusyChange(false);
  }, [busy, props.onBusyChange]);
  return (
    <section className="border-border flex flex-col gap-4 rounded-md border p-4">
      <h2 className="font-medium">
        {variable ? variable.key : tr("automation.variables.create")}
      </h2>
      {variable && (
        <p className="text-muted-foreground text-sm">
          {tr("automation.variables.version", {
            args: [String(variable.version)],
          })}
        </p>
      )}
      <Control
        input={form.input.key}
        label={tr("automation.variables.key")}
        disabled={busy || !props.canManage || !!variable}
      />
      <Control
        input={form.input.kind}
        label={tr("automation.variables.kind")}
        select
        items={automationVariableValueSchema.shape.kind.options.map((kind) => ({
          value: kind,
          label: kindLabels[kind],
        }))}
        disabled={busy || !props.canManage}
      />
      {variable?.value === null ? (
        <p>{variable.reason || tr("automation.redacted")}</p>
      ) : (
        <AutomationValueControl
          key={values.kind}
          label={tr("automation.editor.value")}
          slot={{
            kind: values.kind ?? "text",
            required: true,
            bindable: false,
          }}
          value={value}
          channels={props.channels}
          disabled={busy || !props.canManage}
          onChange={setValue}
        />
      )}
      <p className="text-muted-foreground text-sm">
        {tr("automation.variables.warning")}
      </p>
      {props.canManage && (
        <div className="flex gap-2">
          <Button
            intent="primary"
            disabled={busy || variable?.value === null}
            loading={save.loading}
            onClick={() => void save.run()}
          >
            {tr("automation.editor.save")}
          </Button>
          {variable && (
            <Button
              variant="outlined"
              intent="danger"
              disabled={
                busy ||
                dependents.loading ||
                !dependents.data ||
                dependents.data.items.length > 0 ||
                dependents.data.hasMore
              }
              onClick={() => void remove.run()}
            >
              {tr("automation.delete")}
            </Button>
          )}
        </div>
      )}
      {variable && props.canManage && (
        <>
          <h3 className="font-medium">{tr("automation.variables.usedBy")}</h3>
          {dependents.data?.items.map((rule) => (
            <Button
              key={rule.id}
              variant="link"
              onClick={() =>
                router.push("projectAutomationDetail", {
                  params: { projectSlug: project!.slug, automationId: rule.id },
                })
              }
            >
              {rule.title}
            </Button>
          ))}
          <div className="flex gap-2">
            <Button
              variant="minimal"
              disabled={busy || dependents.loading || !offset}
              onClick={() =>
                setOffset((position) => Math.max(0, position - 50))
              }
            >
              {tr("automation.previous")}
            </Button>
            <Button
              variant="minimal"
              disabled={busy || dependents.loading || !dependents.data?.hasMore}
              onClick={() => setOffset((position) => position + 50)}
            >
              {tr("automation.next")}
            </Button>
          </div>
        </>
      )}
      {affected.map((rule) => (
        <p key={rule.id}>
          {rule.title}:{" "}
          {rule.requiresApproval
            ? tr("automation.reviewRequired")
            : tr("automation.variables.updated")}
        </p>
      ))}
    </section>
  );
};
export default AutomationVariableEditor;
