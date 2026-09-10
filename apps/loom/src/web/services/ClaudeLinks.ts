import type { WorktreeState } from "../../api/schemas/worktreeStateSchema.ts";

/**
 * Links that open a new Claude Code session in the Claude desktop app, and
 * the prompts Loom pre-fills them with.
 *
 * `claude://code/new?folder=<path>&q=<prompt>` is the desktop app's own URL
 * handler: it opens the Code tab's new-session page with the folder selected
 * and the prompt typed, and sends nothing until the user does. It is not
 * documented; it was read from the app's bundle on 2026-09-11 (`prompt` is
 * accepted as an alias of `q`, and `folder` may repeat). Sessions stay in
 * the desktop app; Loom only starts them, and its server runs nothing.
 */
export class ClaudeLinks {
  /**
   * The app cuts `q` at its own limit; a prompt kept under this keeps its
   * last line, which is where the instruction is.
   */
  protected readonly maxPrompt = 4000;

  public newSession(folder: string, prompt?: string): string {
    const params = new URLSearchParams({ folder });
    if (prompt) {
      params.set("q", prompt.slice(0, this.maxPrompt));
    }
    return `claude://code/new?${params.toString()}`;
  }

  /**
   * A prompt to find out why the branch's latest run failed, or `undefined`
   * when there is no failed run to investigate.
   */
  public investigateCi(worktree: WorktreeState): string | undefined {
    const ci = worktree.ci;
    if (!ci || ci.conclusion !== "failure") {
      return undefined;
    }
    const jobs = ci.jobs
      ? ` ${ci.jobs.failed} of ${ci.jobs.total} jobs failed.`
      : "";
    const commit =
      ci.headSha === worktree.head
        ? `commit ${ci.headSha.slice(0, 10)}, this worktree's HEAD`
        : `commit ${ci.headSha.slice(0, 10)}, not this worktree's HEAD (${worktree.head.slice(0, 10)})`;
    return [
      `Investigate why CI failed on branch ${worktree.branch ?? worktree.name}.`,
      `Loom sees: ${ci.name} failed.${jobs} Run: ${ci.url} (${commit}).`,
      "Read the failing jobs' logs with gh, find the cause, and tell me whether it comes from this branch's changes or is a flake before fixing anything.",
    ].join("\n");
  }

  /**
   * A prompt to retire a worktree whose work has landed, stating what Loom
   * sees so the session starts from facts, and refusing to remove anything
   * that is not on the base yet.
   */
  public cleanUp(worktree: WorktreeState, base: string): string {
    const facts: string[] = [];
    const divergence = worktree.divergence;
    if (divergence) {
      facts.push(
        `${divergence.ahead} commit${divergence.ahead === 1 ? "" : "s"} ahead of ${base}, ${divergence.behind} behind`,
      );
    }
    const status = worktree.status;
    if (status) {
      const dirty =
        status.staged + status.modified + status.untracked + status.conflicted;
      facts.push(
        dirty === 0
          ? "no uncommitted changes"
          : `${status.modified} modified, ${status.staged} staged, ${status.untracked} untracked, ${status.conflicted} conflicted`,
      );
      facts.push(
        status.upstream
          ? `upstream ${status.upstream} (${status.ahead} to push)`
          : "no upstream branch",
      );
    }
    if (worktree.stashes > 0) {
      facts.push(
        `${worktree.stashes} stash entr${worktree.stashes === 1 ? "y" : "ies"} on this branch`,
      );
    }
    const claude = worktree.claude;
    if (claude.lock) {
      facts.push(
        `locked by Claude session ${claude.lock.session} (pid ${claude.lock.pid}, ${claude.lock.alive ? "still running" : "ended, the lock is stale"})`,
      );
    }
    if (worktree.quests.length > 0) {
      facts.push(
        `quests ${worktree.quests.map((quest) => `#Q${quest.shortId}`).join(", ")}`,
      );
    }

    return [
      `Clean up the worktree ${worktree.name} (branch ${worktree.branch ?? "detached"}, ${worktree.path}).`,
      `Loom sees: ${facts.join("; ")}.`,
      `Check whether all of this branch's work is on ${base}. If it is, remove the worktree and delete the branch locally and on the remote, following CLAUDE.md's finishing steps. If anything is not on ${base}, list it and stop without removing anything.`,
    ].join("\n");
  }
}
