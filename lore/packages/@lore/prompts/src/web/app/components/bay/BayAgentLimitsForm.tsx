import { Button } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import type { HostCommandController } from "@lore/core/api";
import { HOST_JOBS_LIMIT_CEILING } from "@lore/core/schemas";
import type { I18n } from "@lore/core/web";
import { z } from "alepha";
import { ActionErrorPolicy, useClient } from "alepha/react";
import { useForm, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";

export interface BayAgentLimitsFormProps {
  hostId: string;
  /**
   * The limits the host reports, what the fields start from.
   */
  maxJobs: number;
  /**
   * Absent on a host whose Bay has one lane: no field for it then.
   */
  maxReadJobs?: number;
  /**
   * The command was queued, carrying what changed.
   */
  onSent: (
    commandId: string,
    wanted: { maxJobs?: number; maxReadJobs?: number },
  ) => void;
  /**
   * The server refused it before any command: its words, said on the
   * control.
   */
  onRefused: (reason: string) => void;
  onCancel: () => void;
}

/**
 * The edit of an Agent host's two limits (#Q4543), on `useForm` + `Control`,
 * each from 1 to 16. Only what changed is sent, so a limit set on the machine
 * since the page loaded is not overwritten by the other one's save.
 */
const BayAgentLimitsForm = (props: BayAgentLimitsFormProps) => {
  const { tr } = useI18n<I18n, "en">();
  const commandApi = useClient<HostCommandController>();
  const form = useForm({
    id: "bay-agent-limits",
    schema: z.object({
      maxJobs: z.integer().min(1).max(HOST_JOBS_LIMIT_CEILING),
      maxReadJobs: z.integer().min(1).max(HOST_JOBS_LIMIT_CEILING).optional(),
    }),
    initialValues: {
      maxJobs: props.maxJobs,
      ...(props.maxReadJobs !== undefined
        ? { maxReadJobs: props.maxReadJobs }
        : {}),
    },
    handler: async (input) => {
      const wanted = {
        ...(input.maxJobs !== props.maxJobs ? { maxJobs: input.maxJobs } : {}),
        ...(props.maxReadJobs !== undefined &&
        input.maxReadJobs !== undefined &&
        input.maxReadJobs !== props.maxReadJobs
          ? { maxReadJobs: input.maxReadJobs }
          : {}),
      };
      if (wanted.maxJobs === undefined && wanted.maxReadJobs === undefined) {
        props.onCancel();
        return;
      }
      try {
        const command = await commandApi.enqueueHostCommand({
          params: { hostId: props.hostId },
          body: { kind: "jobs-limits", ...wanted },
        });
        props.onSent(command.id, wanted);
      } catch (error) {
        // A refusal (not connected, out of range) is said on the control,
        // in the server's words, never in a toast.
        if (error instanceof Error) {
          ActionErrorPolicy.markShownInPlace(error);
          props.onRefused(error.message);
          return;
        }
        throw error;
      }
    },
  });
  const { loading } = useFormState(form, ["loading"]);

  return (
    <form {...form.props} className="flex flex-col gap-2">
      <div data-testid="bay-agent-limits-max-jobs">
        <Control
          input={form.input.maxJobs}
          label={tr("hosts.agent.limits.maxJobs")}
        />
      </div>
      {props.maxReadJobs !== undefined && (
        <div data-testid="bay-agent-limits-max-read-jobs">
          <Control
            input={form.input.maxReadJobs}
            label={tr("hosts.agent.limits.maxReadJobs")}
          />
        </div>
      )}
      <span className="text-muted-foreground">
        {tr("hosts.agent.limits.hint", {
          args: [String(HOST_JOBS_LIMIT_CEILING)],
        })}
      </span>
      <span className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={loading}
          data-testid="bay-agent-limits-save"
        >
          {tr("hosts.agent.limits.save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outlined"
          disabled={loading}
          onClick={props.onCancel}
        >
          {tr("hosts.agent.limits.cancel")}
        </Button>
      </span>
    </form>
  );
};

export default BayAgentLimitsForm;
