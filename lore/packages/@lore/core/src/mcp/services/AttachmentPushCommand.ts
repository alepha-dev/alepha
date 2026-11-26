/**
 * Composes the `lore attachments push` line the attach tools hand back: a
 * quest's, a folio's, and a use case run's (#Q3977), and the `pull` line
 * that reads one back (#Q4513).
 *
 * ## Why these tools return a command instead of taking bytes
 *
 * Uploading over MCP means base64 inside a JSON-RPC frame, which is what
 * capped every attachment at 2 MB decoded. Nobody chose that number:
 * `QuestController`'s bucket allows 10 MB and the folio bucket sets no ceiling
 * at all, so the cap was pure transport tax - paid on the exact files a quest
 * is worked from, a retina screenshot or an HTML mockup with an inlined font.
 *
 * The bytes moved to the CLI, where `AttachmentUploader` streams at one chunk
 * of peak memory. `quest_attachment_add` and `folio_attachment_add` kept their
 * names and their descriptions, so an agent looking for "attach a file to a
 * quest" still finds something rather than pasting the file into a comment as
 * text - and what it finds is this line.
 *
 * It replaced `AttachmentUploadService` in the same slot, and for the same
 * reason that one was shared: the two surfaces have to agree on what they tell
 * an agent to run, and a second copy is how one of them quietly starts saying
 * something the other does not.
 */
export class AttachmentPushCommand {
  /**
   * ⚠️ `--project` carries the project's numeric id rather than its slug, and
   * that is a deliberate cost saving rather than an omission.
   * `ProjectTools.resolveProjectId` is written to answer from a membership
   * check alone; fetching the row to learn the slug would put a read back on
   * every call of a tool that no longer does any work. `LoreProjectResolver`
   * takes a numeric value as an id directly and pays no round trip for it, so
   * the line is runnable as printed.
   */
  public compose(input: {
    file: string;
    projectId: number;
    target: "quest" | "folio" | "run";
    /**
     * The quest's or the folio's shortId, or the run's id: a run has no
     * per-project number.
     */
    shortId: number;
    name?: string;
    /**
     * With a run: the criterion the file shows (`C2`) and the scenario step.
     */
    criterion?: string;
    step?: number;
  }): string {
    const parts = [
      "lore attachments push",
      this.quote(input.file),
      `--project ${input.projectId}`,
      `--${input.target} ${input.shortId}`,
    ];
    if (input.criterion) {
      parts.push(`--criterion ${this.quote(input.criterion.toUpperCase())}`);
    }
    if (input.step !== undefined) {
      parts.push(`--step ${input.step}`);
    }
    if (input.name) {
      parts.push(`--name ${this.quote(input.name)}`);
    }
    return parts.join(" ");
  }

  /**
   * The `lore attachments pull` line that fetches one file back (#Q4513),
   * by its shortId on a folio: MCP carries no bytes, so this is how an
   * agent reads a mockup attached to a folio.
   */
  public composePull(input: {
    ref: string | number;
    projectId: number;
    target: "quest" | "folio";
    shortId: number;
  }): string {
    return [
      "lore attachments pull",
      this.quote(String(input.ref)),
      `--project ${input.projectId}`,
      `--${input.target} ${input.shortId}`,
    ].join(" ");
  }

  /**
   * What an agent has to have before the line above will run.
   *
   * ⚠️ The gap this names is real: the MCP session is authenticated as the
   * user, and a shell is not. Without it an agent with no credential gets a
   * failure one layer removed from the tool that sent it there, and reads it
   * as a broken CLI. Both fixes are named, echoing what
   * `LoreClientService.authorization()` already says at the moment of failure.
   */
  public readonly authentication =
    "Run it in a shell that can authenticate to Lore: `lore login` on a machine with a browser, or LORE_API_KEY set from the account's API keys page. Your MCP session's credential does not reach a shell.";

  /**
   * A path or a name, safe to paste into a shell.
   *
   * Single quotes unless the value already carries one, in which case the
   * usual `'\\''` seam. Unquoted would be wrong for the common case of a
   * filename with a space in it, and a command line that silently means
   * something else is worse than one that looks noisy.
   */
  protected quote(value: string): string {
    if (/^[A-Za-z0-9._/@:+-]+$/.test(value)) {
      return value;
    }
    return `'${value.replaceAll("'", `'\\''`)}'`;
  }
}
