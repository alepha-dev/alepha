import { Button } from "@alepha/ui";
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import { AutomationTemplateTokens } from "../../../../../api/schemas/AutomationTemplateTokens.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationCreatedRule from "./AutomationCreatedRule.tsx";
import AutomationRuleEditor from "./AutomationRuleEditor.tsx";
import AutomationRunList from "./AutomationRunList.tsx";

export interface AutomationDetailPageProps {
  automationId: string;
}
const AutomationDetailPage = (props: AutomationDetailPageProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const router = useRouter<AutomationRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [saved, setSaved] = useState<AutomationResource>();
  const [childBusy, setChildBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const read = useQuery(
    {
      key: ["automation", project?.id, props.automationId],
      enabled: !!project,
      handler: ({ signal }) =>
        api.getAutomation(
          { params: { projectId: project!.id, id: props.automationId } },
          { request: { signal } },
        ),
    },
    [project?.id, props.automationId],
  );
  const catalog = useQuery(
    {
      key: ["automation-catalog", project?.id],
      enabled: !!project,
      handler: ({ signal }) =>
        api.getAutomationCatalog(
          { params: { projectId: project!.id } },
          { request: { signal } },
        ),
    },
    [project?.id],
  );
  const rule = saved ?? read.data;
  const referencedKeys =
    rule?.rule && catalog.data
      ? [...new Set(new AutomationTemplateTokens().inValue(rule.rule))].filter(
          (key) =>
            !catalog.data!.entries.some((entry) =>
              Object.hasOwn(entry.fields, key),
            ),
        )
      : [];
  const disable = useAction<[], boolean>(
    {
      handler: async () => {
        if (!rule) return false;
        setSaved(
          await api.setAutomationEnabled({
            params: { projectId: rule.projectId, id: rule.id },
            body: { expectedRevision: rule.revision, enabled: false },
          }),
        );
        queries.invalidate(["automations", rule.projectId]);
        return true;
      },
    },
    [api, rule, queries],
  );
  if (!rule || !project)
    return (
      <p className="text-muted-foreground p-5">
        {tr("automation.editor.loading")}
      </p>
    );
  return (
    <div className="flex max-w-3xl flex-col gap-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold break-words">{rule.title}</h1>
        <Button
          variant="outlined"
          disabled={disable.loading || childBusy}
          onClick={() =>
            router.push("projectAutomationVariables", {
              params: { projectSlug: project.slug },
            })
          }
        >
          {tr("automation.variables.title")}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        {tr("automation.editor.revision", { args: [String(rule.revision)] })}
      </p>
      {rule.redacted ? (
        <p>{rule.redactionReason || tr("automation.redacted")}</p>
      ) : (
        <>
          {!editing && (
            <AutomationCreatedRule
              key={`${rule.id}:${rule.revision}`}
              rule={rule}
              onChange={setSaved}
              onBusyChange={setChildBusy}
              disabled={disable.loading}
              detail
            />
          )}
          <div className="flex flex-wrap gap-3">
            {rule.canEdit && (
              <Button
                variant="outlined"
                disabled={disable.loading || childBusy}
                onClick={() => {
                  if (!editing) setSaved(rule);
                  setEditing((value) => !value);
                }}
              >
                {tr("automation.editor.title")}
              </Button>
            )}
            {!editing && rule.enabled && rule.canDisable && (
              <Button
                variant="outlined"
                loading={disable.loading}
                disabled={disable.loading || childBusy}
                onClick={() => void disable.run()}
              >
                {tr("automation.disable")}
              </Button>
            )}
          </div>
          {conflict && (
            <div role="status" className="border-border rounded-md border p-4">
              <p>{tr("automation.editor.conflict")}</p>
              <Button
                variant="outlined"
                onClick={() => {
                  setSaved(undefined);
                  setEditing(false);
                  setConflict(false);
                  queries.invalidate([
                    "automation",
                    project.id,
                    props.automationId,
                  ]);
                }}
              >
                {tr("automation.editor.reload")}
              </Button>
            </div>
          )}
          {editing && catalog.data && (
            <AutomationRuleEditor
              key={`${rule.id}:${rule.revision}`}
              resource={rule}
              catalogue={catalog.data}
              onSaved={(value) => {
                setSaved(value);
                setEditing(false);
                setConflict(false);
              }}
              onConflict={() => setConflict(true)}
              onBusyChange={setChildBusy}
            />
          )}
          {referencedKeys.length > 0 && (
            <section>
              <h2 className="font-medium">
                {tr("automation.variables.referenced")}
              </h2>
              {referencedKeys.map((key) => (
                <Button
                  key={key}
                  variant="link"
                  disabled={childBusy || disable.loading}
                  onClick={() =>
                    router.push("projectAutomationVariables", {
                      params: { projectSlug: project.slug },
                      query: { key },
                    })
                  }
                >
                  {key}
                </Button>
              ))}
            </section>
          )}
        </>
      )}
      <AutomationRunList automationId={rule.id} />
    </div>
  );
};
export default AutomationDetailPage;
