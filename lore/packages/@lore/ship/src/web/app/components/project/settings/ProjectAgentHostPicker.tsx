import { Button, Card, CardContent } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import {
  currentProjectAtom,
  type I18n,
  setCurrentProject,
  useRank,
} from "@lore/core/web";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { AgentHostController } from "../../../../../api/controllers/AgentHostController.ts";
import type { LentHostResource } from "../../../../../api/schemas/lentHostResourceSchema.ts";
import { agentHostFormSchema } from "../../shared/agentHostFormSchema.ts";

export interface ProjectAgentHostPickerProps {
  /** The hosts this project can use, its own and the lent ones. */
  hosts: LentHostResource[];
}

/**
 * The project's default Agent host (#Q3985): which of the Agent hosts it
 * can use runs its agent jobs. Without one, the agent buttons are hidden.
 */
const ProjectAgentHostPicker = ({ hosts }: ProjectAgentHostPickerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const api = useClient<AgentHostController>();
  const alepha = useAlepha();
  const [project] = useStore(currentProjectAtom);
  const agents = hosts.filter((host) => host.agentHost);

  const form = useForm({
    schema: agentHostFormSchema,
    initialValues: { hostId: project?.defaultAgentHostId ?? "" },
    handler: () => undefined,
  });
  const values = useFormValues(form);

  const save = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        const hostId = values.hostId || null;
        await api.setProjectAgentHost({
          params: { projectId: project.id },
          body: { hostId },
        });
        setCurrentProject(alepha, {
          ...project,
          defaultAgentHostId: hostId ?? undefined,
        });
      },
    },
    [alepha, api, project, values.hostId],
  );

  if (!project) return null;
  const changed = (values.hostId || undefined) !== project.defaultAgentHostId;

  return (
    <Card className="mx-4 md:mx-6" data-testid="project-agent-host">
      <CardContent className="flex flex-col gap-3 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{tr("hosts.agent.default")}</span>
          <span className="text-muted-foreground text-xs">
            {agents.length === 0
              ? tr("hosts.agent.default.none")
              : tr("hosts.agent.default.description")}
          </span>
        </span>
        {agents.length > 0 && (
          <div className="flex items-end gap-2">
            <Control
              select
              input={form.input.hostId}
              label={tr("hosts.agent.default.label")}
              disabled={!can("host:update") || save.loading}
              items={[
                { value: "", label: tr("hosts.agent.default.empty") },
                ...agents.map((host) => ({
                  value: host.id,
                  label: `${host.slug}${host.agentStatus === "unavailable" ? ` (${tr("hosts.agent.status.unavailable")})` : ""}`,
                })),
              ]}
              inputProps={{ "data-testid": "project-agent-host-select" }}
            />
            <Button
              size="sm"
              disabled={!changed || save.loading || !can("host:update")}
              onClick={() => void save.run()}
              data-testid="project-agent-host-save"
            >
              {tr("hosts.agent.default.save")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ProjectAgentHostPicker;
