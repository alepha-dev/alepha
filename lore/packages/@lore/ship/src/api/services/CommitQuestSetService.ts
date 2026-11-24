import {
  BoundParameters,
  CommitReferenceRegistry,
  LiveQuestRegistry,
} from "@lore/core/api";
import { $inject, type FileLike } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import {
  type CommitQuestSet,
  commitQuestSets,
} from "../entities/commitQuestSets.ts";
import { QuestBitmap } from "./QuestBitmap.ts";

/**
 * The one write path of `commit_quest_sets`, and its reads (#E154, folio
 * #F1516).
 *
 * No git here: the pusher walked `base..HEAD` and sends what it found. Lore
 * adds the base's set and the quests whose recorded sha the push walked, and
 * keeps the full set of the pushed commit.
 *
 * ## Two kinds of set (#Q3868)
 *
 * The whole-history set of a commit (`app: ""`), and one per app that
 * declares its paths: the quests of the commits that touched them. Every
 * read and write names which it means through a {@link QuestSetScope}, and
 * the two never mix: an app's set is built on an app's base, walked with the
 * same paths.
 */
export class CommitQuestSetService {
  protected readonly rows = $repository(commitQuestSets);
  protected readonly bound = $inject(BoundParameters);
  protected readonly registry = $inject(LiveQuestRegistry);
  protected readonly references = $inject(CommitReferenceRegistry);

  /**
   * The default branch when the pusher could not read it.
   */
  public static readonly DEFAULT_BRANCH = "main";

  /**
   * A recorded set, told to Plan when its commit is on the default branch
   * (#Q4234): the quests an automation built that it names complete. A push
   * from any other branch, or naming none, completes nothing.
   */
  public async landed(input: {
    projectId: number;
    commitSha: string;
    branch?: string;
    defaultBranch?: string;
    numbers: Set<number>;
  }): Promise<boolean> {
    const target =
      input.defaultBranch?.trim() || CommitQuestSetService.DEFAULT_BRANCH;
    const branch = input.branch?.trim().replace(/^refs\/heads\//, "");
    if (!branch || branch !== target) return false;
    await this.references.landed({
      projectId: input.projectId,
      commitSha: input.commitSha.toLowerCase(),
      branch,
      numbers: [...input.numbers],
    });
    return true;
  }

  /**
   * Which of `shas` already have a set, in the order given (the pusher sends
   * `git rev-list` order, newest first), with whether each is complete.
   *
   * ⚠️ Chunked: D1 refuses more than 100 bound parameters, and a pusher sends
   * up to 200 shas.
   */
  public async known(
    projectId: number,
    shas: string[],
    scope?: QuestSetScope,
  ): Promise<Array<{ sha: string; complete: boolean }>> {
    const wanted = [...new Set(shas.map((sha) => sha.toLowerCase()))];
    const found = await this.find(projectId, wanted, scope?.app);
    return wanted.flatMap((sha) => {
      const row = found.get(sha);
      // A set walked with other paths is no base for this walk.
      return row && this.samePaths(row, scope)
        ? [{ sha, complete: row.complete }]
        : [];
    });
  }

  /**
   * The sets of the given commits, decoded. A commit with no set is absent.
   */
  public async setsOf(
    projectId: number,
    shas: string[],
  ): Promise<Map<string, CommitQuests>> {
    const found = await this.find(projectId, [
      ...new Set(shas.map((sha) => sha.toLowerCase())),
    ]);
    const sets = new Map<string, CommitQuests>();
    for (const [sha, row] of found) {
      sets.set(sha, {
        numbers: QuestBitmap.decode(row.quests),
        complete: row.complete,
      });
    }
    return sets;
  }

  /**
   * The sets kept for apps that declare their paths (#Q3868), for the
   * `(app, commit)` pairs given, keyed by {@link appKey}. A pair with no
   * such set is absent: its copy reads the whole-history set.
   *
   * One read per app, and a project has a handful.
   */
  public async appSetsOf(
    projectId: number,
    pairs: Array<{ app: string; sha: string }>,
  ): Promise<Map<string, CommitQuests & { paths: string }>> {
    const byApp = new Map<string, Set<string>>();
    for (const pair of pairs) {
      const shas = byApp.get(pair.app);
      if (shas) {
        shas.add(pair.sha.toLowerCase());
      } else {
        byApp.set(pair.app, new Set([pair.sha.toLowerCase()]));
      }
    }
    const sets = new Map<string, CommitQuests & { paths: string }>();
    for (const [app, shas] of byApp) {
      if (!app) {
        continue;
      }
      for (const [sha, row] of await this.find(projectId, [...shas], app)) {
        sets.set(CommitQuestSetService.appKey(app, sha), {
          numbers: QuestBitmap.decode(row.quests),
          complete: row.complete,
          paths: row.paths ?? "",
        });
      }
    }
    return sets;
  }

  /**
   * The key of one app's set of one commit in {@link appSetsOf}'s answer.
   */
  public static appKey(app: string, sha: string): string {
    return `${app}\n${sha.toLowerCase()}`;
  }

  /**
   * Compute and keep the full set of a pushed commit:
   * `set(base) + numbers + every quest whose recorded sha prefixes a walked
   * sha`. Complete only when the push says so AND the base's set was.
   *
   * ⚠️ **A complete set replaces an incomplete one, never the reverse.** Two
   * complete sets of one commit are equal by construction, so a second write
   * is a no-op; two incomplete ones are merged, since every number either
   * found is a true ancestor's.
   *
   * With a `scope` (#Q3868) the same, for one app: the base is that app's
   * set walked with the same paths, and the pushed commit's own recorded
   * quests count only when the walk read it, since it may not have touched
   * the paths.
   */
  public async record(input: CommitQuestSetInput): Promise<CommitQuests> {
    const commitSha = input.commitSha.toLowerCase();
    const scope = input.scope;
    let complete = input.complete;
    const numbers = new Set(input.numbers);

    if (input.base) {
      const sha = input.base.toLowerCase();
      const row = (await this.find(input.projectId, [sha], scope?.app)).get(
        sha,
      );
      if (!row || !this.samePaths(row, scope)) {
        // The pusher saw a base Lore no longer has, or one walked with
        // other paths: what it walked is not the whole history.
        complete = false;
      } else {
        for (const n of QuestBitmap.decode(row.quests)) {
          numbers.add(n);
        }
        complete = complete && row.complete;
      }
    }

    for (const n of await this.recordedMatches(
      input.projectId,
      scope ? input.walked : [commitSha, ...input.walked],
    )) {
      numbers.add(n);
    }

    return await this.upsert(
      input.projectId,
      commitSha,
      numbers,
      complete,
      scope,
    );
  }

  /**
   * Whether a row was walked with the scope's paths. A whole-history row
   * has none, and matches no scope.
   */
  protected samePaths(
    row: CommitQuestSet,
    scope: QuestSetScope | undefined,
  ): boolean {
    return (row.paths ?? "") === (scope?.paths ?? "");
  }

  /**
   * The walked shas a push sent as a file part, validated.
   *
   * ⚠️ A 400 when it is not a JSON array of shas, rather than a push that
   * silently drops the quests: the pusher meant them to count.
   */
  public async walkedOf(file: FileLike): Promise<string[]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new BadRequestError(
        "The commit list sent with this push is not valid JSON.",
      );
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (sha) => typeof sha === "string" && /^[0-9a-fA-F]{7,40}$/.test(sha),
      )
    ) {
      throw new BadRequestError(
        "The commit list sent with this push is not a list of commit shas.",
      );
    }
    return (parsed as string[]).map((sha) => sha.toLowerCase());
  }

  /**
   * The quests whose recorded sha (7 to 40 characters) prefixes one of the
   * walked shas. Indexed by the first seven characters, so a first push
   * walking a whole history is one pass over each list.
   */
  protected async recordedMatches(
    projectId: number,
    walked: string[],
  ): Promise<Set<number>> {
    const matches = new Set<number>();
    if (walked.length === 0) {
      return matches;
    }
    const recorded = await this.registry.recordedCommits(projectId);
    if (recorded.length === 0) {
      return matches;
    }
    const byPrefix = new Map<string, string[]>();
    for (const raw of walked) {
      const sha = raw.toLowerCase();
      const key = sha.slice(0, 7);
      const list = byPrefix.get(key);
      if (list) {
        list.push(sha);
      } else {
        byPrefix.set(key, [sha]);
      }
    }
    for (const quest of recorded) {
      for (const sha of quest.shas) {
        const candidates = byPrefix.get(sha.slice(0, 7));
        if (candidates?.some((full) => full.startsWith(sha))) {
          matches.add(quest.number);
          break;
        }
      }
    }
    return matches;
  }

  protected async upsert(
    projectId: number,
    commitSha: string,
    numbers: Set<number>,
    complete: boolean,
    scope?: QuestSetScope,
  ): Promise<CommitQuests> {
    const app = scope?.app ?? "";
    const existing = (await this.find(projectId, [commitSha], app)).get(
      commitSha,
    );
    if (!existing) {
      try {
        await this.rows.create({
          projectId,
          commitSha,
          app,
          ...(scope ? { paths: scope.paths } : {}),
          quests: QuestBitmap.encode(numbers),
          complete,
        });
        return { numbers, complete };
      } catch (error) {
        // Two pushes of one commit raced on the unique key: merge into the
        // row the other one wrote.
        const raced = (await this.find(projectId, [commitSha], app)).get(
          commitSha,
        );
        if (!raced) {
          throw error;
        }
        return await this.merge(raced, numbers, complete, scope);
      }
    }
    return await this.merge(existing, numbers, complete, scope);
  }

  protected async merge(
    existing: CommitQuestSet,
    numbers: Set<number>,
    complete: boolean,
    scope?: QuestSetScope,
  ): Promise<CommitQuests> {
    if (!this.samePaths(existing, scope)) {
      // The app's paths changed since this row was written: the old set
      // answers another question, so it is replaced, complete or not.
      await this.rows.updateById(existing.id, {
        quests: QuestBitmap.encode(numbers),
        complete,
        paths: scope?.paths,
      });
      return { numbers, complete };
    }
    const current = QuestBitmap.decode(existing.quests);
    if (existing.complete) {
      return { numbers: current, complete: true };
    }
    if (!complete) {
      for (const n of current) {
        numbers.add(n);
      }
    }
    await this.rows.updateById(existing.id, {
      quests: QuestBitmap.encode(numbers),
      complete,
    });
    return { numbers, complete };
  }

  /**
   * The rows of the given commits: the whole-history ones, or one app's.
   */
  protected async find(
    projectId: number,
    shas: string[],
    app = "",
  ): Promise<Map<string, CommitQuestSet>> {
    const rows = await this.bound.collect(shas, (batch) =>
      this.rows.findMany({
        where: {
          projectId: { eq: projectId },
          app: { eq: app },
          commitSha: { inArray: batch },
        },
      }),
    );
    return new Map(rows.map((row) => [row.commitSha, row]));
  }
}

export interface CommitQuests {
  numbers: Set<number>;
  complete: boolean;
}

/**
 * One app's sets, walked with its declared paths (#Q3868): git pathspecs
 * joined by line breaks.
 */
export interface QuestSetScope {
  app: string;
  paths: string;
}

export interface CommitQuestSetInput {
  projectId: number;
  commitSha: string;
  /**
   * Keep the set for one app instead of the whole history: the walk read
   * only the commits that touched its paths.
   */
  scope?: QuestSetScope;
  /**
   * The newest ancestor the pusher found a complete set for, when it found
   * one. It walked `base..HEAD` only.
   */
  base?: string;
  /**
   * The quest numbers referenced by the messages it walked.
   */
  numbers: number[];
  /**
   * The full shas it walked, for the recorded-sha matches.
   */
  walked: string[];
  /**
   * False for a shallow clone with no base, no repository, or a failed git.
   */
  complete: boolean;
}
