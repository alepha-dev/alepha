import { $inject, z } from "alepha";
import type { InspectorRun } from "alepha/inspector";
import { $tool } from "alepha/mcp";

import { DevMcpSession } from "./DevMcpSession.ts";

/**
 * `alepha mcp`: the tools that find the running apps and pick one.
 */
export class DevMcpAppTools {
  protected readonly session = $inject(DevMcpSession);

  public readonly appsList = $tool({
    name: "apps_list",
    description:
      "List the Alepha apps running on this machine (alepha dev), and the last dead run of each while its logs remain. Shows which one the other tools act on.",
    annotations: { readOnlyHint: true },
    handler: async () => {
      const runs = await this.session.runs();
      if (!runs.length) {
        return this.session.noApp();
      }
      const selected = await this.session.selected();
      const lines = runs.map((run) => this.line(run, selected));
      lines.push(
        "",
        selected
          ? `Selected: ${selected.name} (${selected.cwd}). Change it with app_select.`
          : "None selected: call app_select with a name, cwd or runId.",
      );
      return lines.join("\n");
    },
  });

  public readonly appSelect = $tool({
    name: "app_select",
    description:
      "Choose the app the other tools act on, by its name, cwd or runId (see apps_list). The choice is kept by cwd, so it survives an alepha dev reload.",
    schema: {
      params: z.object({
        app: z
          .text({ size: "long" })
          .describe("The app's name, its cwd, or a runId from apps_list"),
      }),
    },
    handler: async ({ params }) => {
      const result = await this.session.select(params.app);
      if ("answer" in result) {
        return result.answer;
      }
      const { run } = result;
      return run.status === "live"
        ? `Selected ${run.name} (${run.cwd}), run ${run.runId}.`
        : `Selected ${run.name} (${run.cwd}). Its last run (${run.runId}) is dead: only its logs are readable (logs_tail) until \`alepha dev\` starts it again.`;
    },
  });

  protected line(run: InspectorRun, selected?: InspectorRun): string {
    const mark = selected?.runId === run.runId ? "* " : "- ";
    return `${mark}${run.name} - ${run.status} - cwd ${run.cwd} - pid ${run.pid} - run ${run.runId} - ${run.mode}, alepha ${run.alephaVersion}, started ${run.startedAt}`;
  }
}
