import { BoundParameters, LiveQuestRegistry } from "@lore/core/api";
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
 */
export class CommitQuestSetService {
  protected readonly rows = $repository(commitQuestSets);
  protected readonly bound = $inject(BoundParameters);
  protected readonly registry = $inject(LiveQuestRegistry);

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
  ): Promise<Array<{ sha: string; complete: boolean }>> {
    const wanted = [...new Set(shas.map((sha) => sha.toLowerCase()))];
    const found = await this.find(projectId, wanted);
    return wanted.flatMap((sha) => {
      const row = found.get(sha);
      return row ? [{ sha, complete: row.complete }] : [];
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
   * Compute and keep the full set of a pushed commit:
   * `set(base) + numbers + every quest whose recorded sha prefixes a walked
   * sha`. Complete only when the push says so AND the base's set was.
   *
   * ⚠️ **A complete set replaces an incomplete one, never the reverse.** Two
   * complete sets of one commit are equal by construction, so a second write
   * is a no-op; two incomplete ones are merged, since every number either
   * found is a true ancestor's.
   */
  public async record(input: CommitQuestSetInput): Promise<CommitQuests> {
    const commitSha = input.commitSha.toLowerCase();
    let complete = input.complete;
    const numbers = new Set(input.numbers);

    if (input.base) {
      const base = (await this.setsOf(input.projectId, [input.base])).get(
        input.base.toLowerCase(),
      );
      if (!base) {
        // The pusher saw a base Lore no longer has: what it walked is not
        // the whole history.
        complete = false;
      } else {
        for (const n of base.numbers) {
          numbers.add(n);
        }
        complete = complete && base.complete;
      }
    }

    for (const n of await this.recordedMatches(input.projectId, [
      commitSha,
      ...input.walked,
    ])) {
      numbers.add(n);
    }

    return await this.upsert(input.projectId, commitSha, numbers, complete);
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
  ): Promise<CommitQuests> {
    const existing = (await this.find(projectId, [commitSha])).get(commitSha);
    if (!existing) {
      try {
        await this.rows.create({
          projectId,
          commitSha,
          quests: QuestBitmap.encode(numbers),
          complete,
        });
        return { numbers, complete };
      } catch (error) {
        // Two pushes of one commit raced on the unique key: merge into the
        // row the other one wrote.
        const raced = (await this.find(projectId, [commitSha])).get(commitSha);
        if (!raced) {
          throw error;
        }
        return await this.merge(raced, numbers, complete);
      }
    }
    return await this.merge(existing, numbers, complete);
  }

  protected async merge(
    existing: CommitQuestSet,
    numbers: Set<number>,
    complete: boolean,
  ): Promise<CommitQuests> {
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

  protected async find(
    projectId: number,
    shas: string[],
  ): Promise<Map<string, CommitQuestSet>> {
    const rows = await this.bound.collect(shas, (batch) =>
      this.rows.findMany({
        where: {
          projectId: { eq: projectId },
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

export interface CommitQuestSetInput {
  projectId: number;
  commitSha: string;
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
