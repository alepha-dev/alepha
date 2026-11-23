import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { useAction, useAlepha, useClient, useStore } from "alepha/react";
import { useForm, useFormValues } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

import type { AgentHostController } from "../../../../../api/controllers/AgentHostController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { setCurrentProject } from "../../../services/currentProjectWrite.ts";
import { type I18n } from "../../../services/I18n.ts";
import { agentEgressFormSchema } from "../../shared/agentEgressFormSchema.ts";

export interface ProjectAgentEgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The hosts a push job may reach (#Q3996), opened from the default Agent
 * host's row of the project's Hosts tab (#Q4065), where the Default Agent
 * host card held it.
 */
const ProjectAgentEgressDialog = (props: ProjectAgentEgressDialogProps) => {
  const { tr } = useI18n<I18n, "en">();
  const api = useClient<AgentHostController>();
  const alepha = useAlepha();
  const [project] = useStore(currentProjectAtom);

  const form = useForm({
    schema: agentEgressFormSchema,
    initialValues: { egress: (project?.agentEgressHosts ?? []).join(", ") },
    handler: () => undefined,
  });
  const values = useFormValues(form);

  const save = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        const hosts = String(values.egress ?? "")
          .split(",")
          .map((host: string) => host.trim().toLowerCase())
          .filter(Boolean);
        await api.setProjectAgentEgress({
          params: { projectId: project.id },
          body: { hosts: hosts.length ? hosts : null },
        });
        setCurrentProject(alepha, {
          ...project,
          agentEgressHosts: hosts.length ? hosts : undefined,
        });
        props.onOpenChange(false);
      },
    },
    [alepha, api, project, values.egress, props.onOpenChange],
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("hosts.agent.egress.label")}</DialogTitle>
          <DialogDescription>
            {tr("hosts.agent.egress.description")}
          </DialogDescription>
        </DialogHeader>
        <Control
          input={form.input.egress}
          label=""
          disabled={save.loading}
          inputProps={{
            "data-testid": "project-agent-egress",
            "aria-label": tr("hosts.agent.egress.label"),
          }}
        />
        <DialogFooter>
          <Button
            variant="minimal"
            onClick={() => props.onOpenChange(false)}
            disabled={save.loading}
          >
            {tr("common.cancel")}
          </Button>
          <Button
            onClick={() => void save.run()}
            disabled={save.loading || !api.setProjectAgentEgress.can()}
            data-testid="project-agent-egress-save"
          >
            {tr("hosts.agent.egress.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectAgentEgressDialog;
