import { Badge, Button, useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Hash, Plus } from "lucide-react";
import { useState } from "react";

import type { AutomationChannelController } from "../../../../../api/controllers/AutomationChannelController.ts";
import { automationChannelFormSchema } from "../../../../../api/schemas/automationChannelFormSchema.ts";
import type { AutomationChannelResource } from "../../../../../api/schemas/automationChannelResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { canInProject } from "../../../services/projectRank.ts";
import { usePageCrumb } from "../../shared/usePageCrumb.ts";
import AutomationPage from "./AutomationPage.tsx";

/**
 * Settings > Automations > Channels (#Q3614): In-app and Email, built in,
 * then the project's Discord channels, as many as it wants, each a name and
 * a webhook URL. The URL is typed here and never shown again: saving posts a
 * test message, and a refusal keeps the form open with the reason.
 *
 * Deleting a channel removes it from every rule that named it; those rules
 * keep their other channels and are not paused.
 */
const AutomationChannelsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<AutomationChannelController>();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  usePageCrumb("projectAutomationChannels", tr("automation.channels.title"));
  // `undefined` closed, `null` adding, a channel when editing it.
  const [editing, setEditing] = useState<
    AutomationChannelResource | null | undefined
  >(undefined);
  const projectId = project?.id ?? 0;
  const key = ["automation-channels", projectId];
  const channels = useQuery(
    {
      key,
      enabled: !!project,
      handler: ({ signal }) =>
        api.listAutomationChannels(
          { params: { projectId } },
          { request: { signal } },
        ),
    },
    [projectId],
  );
  const save = useAction<[values: { name: string; url?: string }], void>(
    {
      handler: async (_ctx, values) => {
        const url = values.url?.trim() || undefined;
        if (editing)
          await api.updateAutomationChannel({
            params: { projectId, id: editing.id },
            body: { name: values.name, ...(url ? { url } : {}) },
          });
        else
          await api.createAutomationChannel({
            params: { projectId },
            body: { name: values.name, url: url ?? "" },
          });
        setEditing(undefined);
      },
      invalidates: [key],
    },
    [api, projectId, editing],
  );
  const remove = useAction<[channel: AutomationChannelResource], void>(
    {
      handler: async (_ctx, channel) => {
        if (
          !(await dialog.confirm({
            title: tr("automation.channels.deleteTitle", {
              args: [channel.name],
            }),
            description: tr("automation.channels.deleteDescription"),
            confirmLabel: tr("automation.channels.delete"),
            destructive: true,
          }))
        )
          return;
        await api.deleteAutomationChannel({
          params: { projectId, id: channel.id },
        });
      },
      invalidates: [key],
    },
    [api, projectId],
  );
  const form = useForm(
    {
      schema: automationChannelFormSchema,
      initialValues: { name: editing?.name ?? "", url: "" },
      handler: async (values) => {
        await save.run(values);
      },
    },
    [editing?.id],
  );
  if (!project) return null;
  const canManage = canInProject(project, "automation:manage");
  const busy = save.loading || remove.loading;

  return (
    <AutomationPage
      title={tr("automation.channels.title")}
      description={tr("automation.channels.description")}
      actions={
        canManage && editing === undefined ? (
          <Button onClick={() => setEditing(null)} disabled={busy}>
            <Plus className="size-4" />
            {tr("automation.channels.add")}
          </Button>
        ) : undefined
      }
    >
      {editing !== undefined && (
        <form
          {...form.props}
          className="bg-card flex flex-col gap-3 rounded-lg border p-4"
          data-testid="automation-channel-form"
        >
          <Control
            input={form.input.name}
            label={tr("automation.channels.name")}
            disabled={busy}
          />
          <Control
            input={form.input.url}
            label={
              editing
                ? tr("automation.channels.replaceUrl")
                : tr("automation.channels.url")
            }
            disabled={busy}
          />
          <p className="text-muted-foreground text-sm">
            {tr("automation.channels.urlHelp")}
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {tr("automation.channels.save")}
            </Button>
            <Button
              type="button"
              variant="outlined"
              disabled={busy}
              onClick={() => setEditing(undefined)}
            >
              {tr("automation.channels.cancel")}
            </Button>
          </div>
        </form>
      )}
      <ul className="bg-card divide-y rounded-lg border">
        {(channels.data?.items ?? []).map((channel) => (
          <li
            key={channel.id}
            className="flex items-center gap-3 px-4 py-3"
            data-testid={`automation-channel-${channel.builtIn ? channel.id : channel.name}`}
          >
            <Hash className="text-muted-foreground size-4" />
            <span className="font-medium">{channel.name}</span>
            <Badge variant="outline">
              {tr(`automation.channels.kind.${channel.kind}`, {
                default: channel.kind,
              })}
            </Badge>
            {channel.builtIn ? (
              <span className="text-muted-foreground ms-auto text-sm">
                {tr("automation.channels.builtIn")}
              </span>
            ) : (
              canManage && (
                <span className="ms-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => setEditing(channel)}
                  >
                    {tr("automation.channels.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outlined"
                    intent="danger"
                    disabled={busy}
                    onClick={() => void remove.run(channel)}
                  >
                    {tr("automation.channels.delete")}
                  </Button>
                </span>
              )
            )}
          </li>
        ))}
      </ul>
    </AutomationPage>
  );
};

export default AutomationChannelsPage;
