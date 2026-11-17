import { $inject } from "alepha";
import { ShellProvider } from "alepha/system";

/**
 * The quests a commit's history references, as a push sends them to Lore
 * (#E154, folio #F1516).
 *
 * ## Incremental, never the whole history twice
 *
 * When commit B is an ancestor of HEAD, `set(HEAD) = set(B) + refs(B..HEAD)`:
 * nothing is removed along ancestry. So the walk asks Lore which of the newest
 * {@link CANDIDATES} commits already have a set, takes the newest complete one
 * as its base, and reads only `base..HEAD`. A first push reads the whole
 * history, once (0.08 s over 9,000 commits).
 *
 * ## Complete or partial
 *
 * Partial when the clone is shallow and no base was found, when there is no
 * repository, or when git fails. The refs found are still sent, since each is
 * a true ancestor's, and a push never fails over this. A shallow clone that
 * finds a complete base is complete: the range it walked is all it needed.
 *
 * Through `ShellProvider`, so a spec can run it on a real fixture repository.
 */
export class GitQuestHistory {
  protected readonly shell = $inject(ShellProvider);

  /**
   * How many of HEAD's newest commits are offered to Lore as a base.
   */
  public static readonly CANDIDATES = 200;

  /**
   * The most walked shas a push sends: Lore reads an 8 MB part, and a sha is
   * 43 bytes of JSON. Past it the walk is partial.
   */
  public static readonly MAX_WALKED = 150_000;

  /**
   * The highest quest number Lore's bitmap holds.
   */
  public static readonly MAX_NUMBER = 393_215;

  /**
   * `#Q<n>`, anywhere in a subject or a body.
   */
  protected static readonly QUEST_REF = /#Q(\d+)\b/g;

  /**
   * A bare `#<n>`, counted only when the project opts in: GitHub's squash
   * merge writes `(#123)` for a pull request in every subject. Not after a
   * word character, `&` or `#`, so `&#123;` and `##12` are not read.
   */
  protected static readonly BARE_REF = /(?<![\w&#])#(\d+)\b/g;

  public async walk(input: {
    root: string;
    /**
     * Count a bare `#<n>` too (`.alepha/lore.json`'s `bareQuestRefs`).
     */
    bare: boolean;
    /**
     * Lore's answer for which of the candidates have a set, in the order
     * given. Undefined when it cannot be asked (an older Lore).
     */
    known: (
      shas: string[],
    ) => Promise<Array<{ sha: string; complete: boolean }> | undefined>;
  }): Promise<QuestWalk> {
    const head = await this.git(input.root, ["rev-parse", "HEAD"]);
    if (!head.ok || !head.out) {
      return {
        numbers: [],
        walked: [],
        complete: false,
        reason: "no-repository",
      };
    }
    const candidates = await this.git(input.root, [
      "rev-list",
      "-n",
      String(GitQuestHistory.CANDIDATES),
      "HEAD",
    ]);
    if (!candidates.ok) {
      return { numbers: [], walked: [], complete: false, reason: "git-failed" };
    }
    const shas = candidates.out.split("\n").filter(Boolean);

    let base: string | undefined;
    const known = await input.known(shas).catch(() => undefined);
    if (known) {
      const complete = new Set(
        known.filter((it) => it.complete).map((it) => it.sha.toLowerCase()),
      );
      base = shas.find((sha) => complete.has(sha.toLowerCase()));
    }

    const shallow = await this.git(input.root, [
      "rev-parse",
      "--is-shallow-repository",
    ]);

    // %x1f between the sha and the message, %x1e after each commit: neither
    // can appear in a commit message git would accept from a person.
    const log = await this.git(input.root, [
      "log",
      "--format=%H%x1f%B%x1e",
      base ? `${base}..HEAD` : "HEAD",
    ]);
    if (!log.ok) {
      return {
        ...(base ? { base } : {}),
        numbers: [],
        walked: [],
        complete: false,
        reason: "git-failed",
      };
    }

    const numbers = new Set<number>();
    const walked: string[] = [];
    for (const record of log.out.split("\x1e")) {
      const [sha, message = ""] = record.replace(/^\s+/, "").split("\x1f");
      if (!sha) {
        continue;
      }
      walked.push(sha.trim().toLowerCase());
      for (const n of this.refs(message, input.bare)) {
        numbers.add(n);
      }
    }

    let reason: QuestWalk["reason"];
    if (!base && shallow.out === "true") {
      reason = "shallow";
    } else if (walked.length > GitQuestHistory.MAX_WALKED) {
      reason = "too-long";
    }

    return {
      ...(base ? { base } : {}),
      numbers: [...numbers].sort((a, b) => a - b),
      walked: walked.slice(0, GitQuestHistory.MAX_WALKED),
      complete: reason === undefined,
      ...(reason ? { reason } : {}),
    };
  }

  /**
   * The quest numbers one message references.
   */
  public refs(message: string, bare: boolean): number[] {
    const found: number[] = [];
    const add = (raw: string | undefined) => {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= GitQuestHistory.MAX_NUMBER) {
        found.push(n);
      }
    };
    for (const match of message.matchAll(GitQuestHistory.QUEST_REF)) {
      add(match[1]);
    }
    if (bare) {
      for (const match of message.matchAll(GitQuestHistory.BARE_REF)) {
        add(match[1]);
      }
    }
    return found;
  }

  protected async git(
    root: string,
    args: string[],
  ): Promise<{ ok: boolean; out: string }> {
    try {
      const result = await this.shell.capture(["git", ...args], { root });
      return { ok: result.exitCode === 0, out: result.stdout.trim() };
    } catch {
      return { ok: false, out: "" };
    }
  }
}

export interface QuestWalk {
  /**
   * The newest ancestor Lore had a complete set for, when there was one.
   */
  base?: string;
  numbers: number[];
  walked: string[];
  complete: boolean;
  /**
   * Why the walk is partial: a shallow clone with no base, no repository, a
   * failed git, or a history past {@link GitQuestHistory.MAX_WALKED}.
   */
  reason?: "shallow" | "no-repository" | "git-failed" | "too-long";
}
