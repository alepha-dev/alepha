import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";
import type { HostJobSource } from "../schemas/hostJobInputSchema.ts";

/**
 * The preamble Lore renders above every agent job's prompt (#Q4224), on a
 * light Agent host: the run is an agent CLI in a workspace directory kept
 * between runs of the same work, with the host's own tools and Lore's MCP
 * server, and no sandbox. It says where things are:
 *
 * - the code, as the job's source prepared it before the agent started
 *   (#E173): a read-only checkout at `./src`, a worktree on the job's branch,
 *   or nothing. The agent never clones, fetches or resets;
 * - Lore, reached through its MCP tools, already configured for the run;
 *   the `lore` CLI is not signed in for the job (its key reaches the MCP
 *   only, and a CLI signed in on the host would reach past the job's pins);
 * - nobody reads the run's chat: what the agent did is what it wrote to
 *   Lore.
 *
 * A prompt marks where the preamble goes with {@link MARKER}: the job's
 * source is settled when the job is started (`AgentJobService`), after the
 * caller built its prompt, so the preamble is rendered there.
 */
export class AgentRunPreamble {
  /**
   * Where a prompt wants the preamble. Replaced by `AgentJobService.start`
   * once the job's source is known; a prompt without it gets the preamble
   * above it.
   */
  public static readonly MARKER = "<<<LORE_AGENT_RUN_PREAMBLE>>>";

  protected readonly projects = $repository(projects);

  /**
   * The project's repository URL, or undefined when it names none.
   */
  public async repositoryOf(projectId: number): Promise<string | undefined> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    return project?.repositoryUrl || undefined;
  }

  /**
   * The preamble's lines for a job's source. `repository` is the URL the
   * job was prepared from, for `read` and `write`.
   */
  public render(source: HostJobSource, repository?: string): string {
    const ref = source.ref ? `\`${source.ref}\`` : "its default branch";
    const code =
      source.mode === "read"
        ? [
            `- **The code of ${repository} at ${ref}** is in \`./src\`, checked out before you started (\`git -C src rev-parse HEAD\` gives the commit, \`git -C src log\` its history). It is read-only: this run writes only to Lore. Do not clone, fetch or check out anything.`,
          ]
        : source.mode === "write"
          ? [
              `- **You are already in a git worktree of ${repository}**, on branch \`${source.branch}\`, made from ${ref} or continuing the branch the remote already has. Do not make another worktree or branch, and do not rename this one. The repository's procedure may ask for a worktree of your own or a branch cut from the latest main: this run has both already, so skip those steps.`,
              "- **Push before you finish**: unpushed work is kept on the host, not delivered.",
            ]
          : [
              "- **This project names no GitHub repository** in Lore, so the workspace holds no code. Work from Lore alone, unless the project's procedure below says where its code lives.",
            ];
    return [
      "## Where things are",
      "",
      "- **You are an agent job** on one of the project's Agent hosts, in this run's workspace: a directory kept between runs of the same work, so what a previous run left beside the code is still here.",
      ...code,
      "- **Lore is reached through its MCP tools**, already configured for this run (server `lore`): every Lore read and write goes through them. The `lore` CLI is not signed in for you: do not use it.",
      "- **Nobody reads this run's chat.** What you did is what you wrote to Lore; your final message is a short summary.",
    ].join("\n");
  }

  /**
   * A prompt with its preamble in place: at the marker, or above it.
   */
  public place(prompt: string, preamble: string): string {
    return prompt.includes(AgentRunPreamble.MARKER)
      ? prompt.replace(AgentRunPreamble.MARKER, () => preamble)
      : `${preamble}\n\n${prompt}`;
  }
}
