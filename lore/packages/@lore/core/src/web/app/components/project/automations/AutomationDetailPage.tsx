import { Badge, Button, useDialog } from "@alepha/ui";
import {
  useAction,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Braces, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationResource } from "../../../../../api/schemas/automationResourceSchema.ts";
import { AutomationTemplateTokens } from "../../../../../api/schemas/AutomationTemplateTokens.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationPage from "./AutomationPage.tsx";
import AutomationRuleEditor from "./AutomationRuleEditor.tsx";
import AutomationRuleSummary from "./AutomationRuleSummary.tsx";
import AutomationRunList from "./AutomationRunList.tsx";
import AutomationTestPanel from "./AutomationTestPanel.tsx";
import { useAutomationLabels } from "./useAutomationLabels.ts";

export interface AutomationDetailPageProps {
  automationId: string;
}

/**
 * One rule: what it does, a dry run against current data, its history, and
 * the header actions that change it. A preset lands here once created.
 */
const AutomationDetailPage = (props: AutomationDetailPageProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const dialog = useDialog();
  const router = useRouter<AutomationRouter>();
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
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
  const toggle = useAction<[enabled: boolean], boolean>(
    {
      handler: async (_context, enabled) => {
        if (!rule) return false;
        try {
          setSaved(
            await api.setAutomationEnabled({
              params: { projectId: rule.projectId, id: rule.id },
              body: { expectedRevision: rule.revision, enabled },
            }),
          );
        } catch (error) {
          // A refused enable can still have moved health or revision.
          setSaved(undefined);
          queries.invalidate(["automation", rule.projectId, rule.id]);
          throw error;
        } finally {
          queries.invalidate(["automations", rule.projectId]);
        }
        return true;
      },
    },
    [api, rule, queries],
  );
  const remove = useAction<[], boolean>(
    {
      handler: async () => {
        if (!rule || !project) return false;
        if (
          !(await dialog.confirm({
            title: tr("automation.delete.title"),
            description: tr("automation.delete.description", {
              args: [rule.title],
            }),
            confirmLabel: tr("automation.delete"),
            destructive: true,
          }))
        )
          return false;
        await api.deleteAutomation({
          params: { projectId: rule.projectId, id: rule.id },
          body: { expectedRevision: rule.revision },
        });
        queries.invalidate(["automations", rule.projectId]);
        await router.push("projectAutomations", {
          params: { projectSlug: project.slug },
        });
        return true;
      },
    },
    [api, rule, project?.slug, queries, dialog, tr],
  );
  if (!project) return null;
  if (!rule)
    return (
      <AutomationPage title={tr("automation.editor.loading")}>
        {read.error && (
          <p role="alert" className="text-danger-text">
            {read.error.message}
          </p>
        )}
      </AutomationPage>
    );
  const busy = toggle.loading || remove.loading || childBusy;
  const referencedKeys =
    rule.rule && catalog.data
      ? [...new Set(new AutomationTemplateTokens().inValue(rule.rule))].filter(
          (key) =>
            !catalog.data!.entries.some((entry) =>
              Object.hasOwn(entry.fields, key),
            ),
        )
      : [];
  return (
    <AutomationPage
      title={rule.title}
      badge={
        <Badge variant="tint" tone={labels.tones[rule.displayState]}>
          {labels.states[rule.displayState]}
        </Badge>
      }
      description={labels.trigger(rule.rule)}
      actions={
        !editing && (
          <>
            {rule.canEdit && !rule.redacted && (
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => {
                  setSaved(rule);
                  setEditing(true);
                }}
              >
                <Pencil className="size-4" />
                {tr("automation.edit")}
              </Button>
            )}
            {rule.canDelete && (
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => void remove.run()}
              >
                <Trash2 className="size-4" />
                {tr("automation.delete")}
              </Button>
            )}
            {rule.enabled && rule.canDisable && (
              <Button
                variant="outlined"
                loading={toggle.loading}
                disabled={busy}
                onClick={() => void toggle.run(false)}
              >
                <Pause className="size-4" />
                {tr("automation.disable")}
              </Button>
            )}
            {!rule.enabled && rule.canEnable && (
              <Button
                loading={toggle.loading}
                disabled={busy}
                onClick={() => void toggle.run(true)}
              >
                <Play className="size-4" />
                {tr("automation.enable")}
              </Button>
            )}
          </>
        )
      }
    >
      {(rule.reason || rule.requiresApproval) && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
        >
          {rule.reason && <p>{rule.reason}</p>}
          {rule.requiresApproval && (
            <p className="text-muted-foreground">
              {tr("automation.reviewRequired")}
            </p>
          )}
        </div>
      )}
      {!rule.enabled && rule.canEnable && !editing && (
        <p className="text-muted-foreground text-sm">
          {tr("automation.setup.enableDescription")}
        </p>
      )}
      {conflict && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"
        >
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
      {rule.redacted ? (
        <p className="text-muted-foreground text-sm">
          {rule.redactionReason || tr("automation.redacted")}
        </p>
      ) : editing && catalog.data ? (
        <AutomationRuleEditor
          key={`${rule.id}:${rule.revision}`}
          resource={rule}
          catalogue={catalog.data}
          onSaved={(value) => {
            setSaved(value);
            setEditing(false);
            setConflict(false);
            queries.invalidate(["automations", value.projectId]);
          }}
          onCancel={() => {
            setEditing(false);
            setConflict(false);
          }}
          onConflict={() => setConflict(true)}
          onBusyChange={setChildBusy}
        />
      ) : (
        <>
          <AutomationRuleSummary rule={rule} />
          {referencedKeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {tr("automation.variables.referenced")}
              </span>
              {referencedKeys.map((key) => (
                <Button
                  key={key}
                  variant="outlined"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    router.push("projectAutomationVariables", {
                      params: { projectSlug: project.slug },
                      query: { key },
                    })
                  }
                >
                  <Braces className="size-3" />
                  {key}
                </Button>
              ))}
            </div>
          )}
          <AutomationTestPanel
            key={`${rule.id}:${rule.revision}`}
            rule={rule}
            disabled={toggle.loading || remove.loading}
            onBusyChange={setChildBusy}
          />
        </>
      )}
      {!editing && <AutomationRunList automationId={rule.id} />}
    </AutomationPage>
  );
};

export default AutomationDetailPage;
