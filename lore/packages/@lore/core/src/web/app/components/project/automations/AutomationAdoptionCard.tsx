import { Button, useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useQuery, useQueryClient } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { automationAdoptionFormSchema } from "../../../../../api/schemas/automationAdoptionFormSchema.ts";
import type { AutomationAdoptionPolicy } from "../../../../../api/schemas/automationAdoptionPolicySchema.ts";
import type { ProjectResource } from "../../../../../api/schemas/projectResourceSchema.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface AutomationAdoptionCardProps {
  project: ProjectResource;
  policy: AutomationAdoptionPolicy;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}
const AutomationAdoptionCard = (props: AutomationAdoptionCardProps) => {
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const dialog = useDialog();
  const router = useRouter<AutomationRouter>();
  const { tr } = useI18n<I18n, "en">();
  const [offset, setOffset] = useState(0);
  const preview = useQuery(
    {
      key: ["automation-adoption", props.project.id, props.policy],
      handler: ({ signal }) =>
        api.previewAutomationAdoption(
          { params: { projectId: props.project.id, policy: props.policy } },
          { request: { signal } },
        ),
    },
    [props.project.id, props.policy],
  );
  const choices = useQuery(
    {
      key: ["automations", props.project.id, "adoption", offset],
      handler: ({ signal }) =>
        api.listAutomations(
          {
            params: { projectId: props.project.id },
            query: { offset, limit: 50 },
          },
          { request: { signal } },
        ),
    },
    [props.project.id, offset],
  );
  const form = useForm({
    schema: automationAdoptionFormSchema,
    initialValues: { automationId: "new" },
    handler: () => undefined,
  });
  const values = useFormValues(form);
  const adopt = useAction<[], boolean>(
    {
      handler: async () => {
        const existing = choices.data?.items.find(
          (item) => item.id === values.automationId,
        );
        if (
          !(await dialog.confirm({
            title: tr("automation.adoption.confirmTitle"),
            description: tr("automation.adoption.confirmDescription", {
              args: [preview.data?.author.name ?? ""],
            }),
            confirmLabel: tr("automation.adoption.adopt"),
          }))
        )
          return false;
        await api.adoptAutomationPolicy({
          params: { projectId: props.project.id, policy: props.policy },
          body: {
            confirm: true,
            ...(existing
              ? {
                  automationId: existing.id,
                  expectedRevision: existing.revision,
                }
              : {}),
          },
        });
        queries.invalidate(["automation-adoption", props.project.id]);
        queries.invalidate(["automations", props.project.id]);
        return true;
      },
    },
    [
      api,
      values.automationId,
      choices.data,
      props.project.id,
      props.policy,
      preview.data,
      dialog,
      queries,
      tr,
    ],
  );
  useEffect(() => {
    props.onBusyChange(adopt.loading);
  }, [adopt.loading, props.onBusyChange]);
  const data = preview.data;
  const busy = props.disabled || adopt.loading;
  const states = {
    legacy: tr("automation.adoption.legacy"),
    pending: tr("automation.adoption.pending"),
    adopted: tr("automation.adoption.adopted"),
    opted_out: tr("automation.adoption.optedOut"),
  };
  if (!data) return <p>{preview.error?.message ?? tr("automation.loading")}</p>;
  const available =
    choices.data?.items.filter(
      (item) => item.canEdit && item.rule?.compatibility === props.policy,
    ) ?? [];
  return (
    <section className="border-border flex flex-col gap-4 rounded-lg border p-5">
      <div>
        <h2 className="font-semibold">
          {props.policy === "quest-reminders"
            ? tr("automation.adoption.reminders")
            : tr("automation.adoption.releases")}
        </h2>
        <p className="text-muted-foreground text-sm">{states[data.state]}</p>
      </div>
      <p className="text-sm">
        {props.policy === "quest-reminders"
          ? tr("automation.adoption.reminderDescription")
          : tr("automation.adoption.releaseDescription")}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt>{tr("automation.adoption.author")}</dt>
        <dd>{data.author.name}</dd>
        <dt>{tr("automation.adoption.channels")}</dt>
        <dd>{data.channels.join(", ")}</dd>
        <dt>{tr("automation.adoption.grants")}</dt>
        <dd className="break-words">{data.permissions.join(", ")}</dd>
      </dl>
      <div className="text-sm">
        <h3 className="font-medium">{tr("automation.adoption.recipients")}</h3>
        <p className="break-words">
          {data.recipients.map((item) => item.label).join(", ") ||
            tr("automation.adoption.noRecipients")}
        </p>
        {data.recipientsHasMore && (
          <p>{tr("automation.adoption.moreRecipients")}</p>
        )}
      </div>
      {data.reminderCount !== undefined && (
        <div className="text-sm">
          <p>
            {tr("automation.adoption.reminderCount", {
              args: [String(data.reminderCount)],
            })}
          </p>
          <ul className="mt-2 space-y-1">
            {data.reminders?.map((item) => (
              <li key={item.id}>
                #Q{item.shortId}: {item.assigneeId}, {item.interval},{" "}
                {item.nextAt}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.reason && <p className="text-warning text-sm">{data.reason}</p>}
      {data.state === "legacy" && (
        <>
          <Control
            input={form.input.automationId}
            label={tr("automation.adoption.replacement")}
            select
            items={[
              { value: "new", label: tr("automation.adoption.create") },
              ...available.map((item) => ({
                value: item.id,
                label: item.title,
              })),
            ]}
            disabled={busy || choices.loading}
          />
          <div className="flex gap-2">
            <Button
              variant="minimal"
              disabled={busy || !offset || choices.loading}
              onClick={() => setOffset((at) => Math.max(0, at - 50))}
            >
              {tr("automation.previous")}
            </Button>
            <Button
              variant="minimal"
              disabled={busy || !choices.data?.hasMore || choices.loading}
              onClick={() => setOffset((at) => at + 50)}
            >
              {tr("automation.next")}
            </Button>
          </div>
        </>
      )}
      {["legacy", "pending"].includes(data.state) && (
        <Button
          intent="primary"
          loading={adopt.loading}
          disabled={
            busy ||
            !data.ready ||
            (values.automationId !== "new" &&
              !available.some((item) => item.id === values.automationId))
          }
          onClick={() => void adopt.run()}
        >
          {data.state === "pending"
            ? tr("automation.adoption.resume")
            : tr("automation.adoption.adopt")}
        </Button>
      )}
      {data.replacementId && data.candidate && (
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() =>
            router.push("projectAutomationDetail", {
              params: {
                projectSlug: props.project.slug,
                automationId: data.replacementId!,
              },
            })
          }
        >
          {tr("automation.adoption.open")}
        </Button>
      )}
      <p className="text-muted-foreground text-xs">
        {tr("automation.adoption.optOutDescription")}
      </p>
    </section>
  );
};
export default AutomationAdoptionCard;
