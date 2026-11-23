import { AlephaError } from "alepha";

/**
 * Where a project's repository lives, by URL: what an agent job clones into
 * its workspace. Registered by whichever module holds the project's setting
 * for it; with none registered, a project names no repository.
 */
export type ProjectRepositoryLookup = (
  projectId: number,
) => Promise<string | undefined>;

/**
 * The preamble Lore renders above every agent job's prompt (#Q4224), on a
 * light Agent host: the run is an agent CLI in a workspace directory kept
 * between runs of the same work, with the host's own tools and Lore's MCP
 * server, and no sandbox. It says where things are:
 *
 * - the workspace, and the project's repository: clone it into the
 *   directory when it is empty, otherwise fetch and reset to its default
 *   branch; a read-only run changes nothing in it;
 * - Lore, reached through its MCP tools, already configured for the run;
 *   the `lore` CLI is not signed in for the job (its key reaches the MCP
 *   only, the epic's blocker 1);
 * - nobody reads the run's chat: what the agent did is what it wrote to
 *   Lore.
 */
export class AgentRunPreamble {
  protected repository?: ProjectRepositoryLookup;

  /**
   * Registers where a project's repository URL is read from.
   */
  public registerRepository(lookup: ProjectRepositoryLookup): void {
    if (this.repository) {
      throw new AlephaError(
        "A project repository lookup is already registered",
      );
    }
    this.repository = lookup;
  }

  /**
   * The project's repository URL, or undefined when it names none.
   */
  public async repositoryOf(projectId: number): Promise<string | undefined> {
    return this.repository?.(projectId);
  }

  /**
   * The preamble's lines. `changes` is whether the run may change the
   * repository (a quest's work) or must leave it as it found it (a triage,
   * a review).
   */
  public async render(projectId: number, changes: boolean): Promise<string> {
    const url = await this.repositoryOf(projectId);
    const repository = url
      ? `- **The repository** is ${url}. If this directory is empty, clone it here (\`git clone ${url} .\`); otherwise \`git fetch\` and reset to its default branch first.${changes ? "" : " Change nothing in it: this run reads the code, it writes only to Lore."}`
      : "- **This project names no repository** in Lore. Work from Lore alone, unless the project's procedure below says where its code lives.";
    return [
      "## Where things are",
      "",
      "- **You are an agent job** on one of the project's Agent hosts, in this run's workspace: a directory kept between runs of the same work, so what a previous run left is still here.",
      repository,
      "- **Lore is reached through its MCP tools**, already configured for this run (server `lore`): every Lore read and write goes through them. The `lore` CLI is not signed in for you: do not use it.",
      "- **Nobody reads this run's chat.** What you did is what you wrote to Lore; your final message is a short summary.",
    ].join("\n");
  }
}
