import type { WorkflowController } from "@lore/ship/api";
import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore workflow list|run|rerun|cancel` (#Q4366): the connected
 * repository's GitHub workflows, the `workflow_*` MCP tools' twins. A
 * start, re-run or cancel needs `deploy:workflow`, lands on the project's
 * activity, and is refused under an agent job's key.
 */
export class WorkflowCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly projects = $inject(LoreProjectResolver);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<WorkflowController>(this.client.scope());

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly list = $command({
    name: "list",
    description:
      "The workflows the connected repository can start, with their inputs, and the recent runs",
    flags: z.object({
      ...WorkflowCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const it = await this.api.getWorkflows({ params: { projectId } });
        if (flags.output === "json") {
          this.render.json(print, it);
          return;
        }
        if (!it.connected) {
          print(
            "The project is not connected to GitHub: lore github install, then open the link",
          );
          return;
        }
        print(`Workflows of ${it.repository}:`);
        this.render.list(
          print,
          it.workflows.map((workflow) => ({
            handle: String(workflow.id),
            title: workflow.name,
            fields: [
              workflow.inputs.length
                ? workflow.inputs
                    .map((input) => `${input.name}${input.required ? "*" : ""}`)
                    .join(" ")
                : "no input",
              workflow.path,
            ],
          })),
          undefined,
          "No workflow declares workflow_dispatch.",
        );
        print("");
        print("Recent runs:");
        this.render.list(
          print,
          it.runs.map((run) => ({
            handle: String(run.id),
            title: `${run.name} on ${run.branch}`,
            fields: [
              run.conclusion ?? run.status,
              run.requestedBy ? `by ${run.requestedBy}` : run.event,
            ],
          })),
          undefined,
          "No run yet.",
        );
      });
    },
  });

  public readonly run = $command({
    name: "run",
    description:
      "Start a workflow on a branch or tag with its inputs (deploy:workflow)",
    flags: z.object({
      ...WorkflowCommand.PROJECT_FLAG,
      workflowId: z
        .integer()
        .describe("The workflow's id, as `lore workflow list` shows it."),
      ref: z.text({ description: "The branch or tag to run it on." }),
      inputs: z
        .array(z.text())
        .describe("An input as name=value, repeated.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const inputs = this.inputsOf(flags.inputs);
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const it = await this.api.dispatchWorkflow({
          params: { projectId },
          body: {
            workflowId: flags.workflowId,
            ref: flags.ref,
            ...(Object.keys(inputs).length ? { inputs } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          it,
          `Started workflow ${flags.workflowId} on ${flags.ref}: its run shows in lore workflow list once GitHub starts it`,
        );
      });
    },
  });

  public readonly rerun = $command({
    name: "rerun",
    description: "Re-run a run, or only its failed jobs (deploy:workflow)",
    flags: z.object({
      ...WorkflowCommand.PROJECT_FLAG,
      runId: z
        .integer()
        .describe("The run's id, as `lore workflow list` shows it."),
      failedOnly: z
        .boolean()
        .describe("Re-run only the failed jobs.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const it = await this.api.rerunWorkflowRun({
          params: { projectId, runId: flags.runId },
          body: { failedOnly: flags.failedOnly ?? false },
        });
        this.render.written(
          print,
          flags.output,
          it,
          flags.failedOnly
            ? `Re-running the failed jobs of run ${flags.runId}`
            : `Re-running run ${flags.runId}`,
        );
      });
    },
  });

  public readonly cancel = $command({
    name: "cancel",
    description: "Cancel a run (deploy:workflow)",
    flags: z.object({
      ...WorkflowCommand.PROJECT_FLAG,
      runId: z
        .integer()
        .describe("The run's id, as `lore workflow list` shows it."),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const it = await this.api.cancelWorkflowRun({
          params: { projectId, runId: flags.runId },
        });
        this.render.written(
          print,
          flags.output,
          it,
          `Cancelling run ${flags.runId}`,
        );
      });
    },
  });

  public readonly workflow = $command({
    name: "workflow",
    description: "The GitHub workflows of the project's connected repository",
    children: [this.list, this.run, this.rerun, this.cancel],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * `name=value` pairs, the value taking everything after the first `=`.
   */
  protected inputsOf(values: string[] | undefined): Record<string, string> {
    const inputs: Record<string, string> = {};
    for (const pair of values ?? []) {
      const at = pair.indexOf("=");
      if (at < 1) {
        throw new AlephaError(`An input is name=value, got "${pair}"`);
      }
      inputs[pair.slice(0, at)] = pair.slice(at + 1);
    }
    return inputs;
  }
}
