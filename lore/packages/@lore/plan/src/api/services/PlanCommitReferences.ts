import {
  type CommitQuest,
  type CommitReferenceInput,
  CommitReferenceRegistry,
  type CommitReferenceResult,
  LoreAudits,
} from "@lore/core/api";
import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { type Quest, quests } from "../entities/quests.ts";
import { QuestResourceMapper } from "./QuestResourceMapper.ts";

/**
 * Plan's half of commit references (#Q3945): a pushed commit whose message
 * names `#Q<n>` of the project lands on that quest's commit trail, `by` the
 * pusher. Build calls it through the core registry after a push.
 *
 * **Idempotent by quest and sha prefix**: a commit is skipped when the quest
 * already carries it under any length, so a push of a commit
 * `quest_commit_add` already recorded as `1823ec399` adds nothing.
 */
export class PlanCommitReferences {
  /**
   * `#Q123`, as a word: not inside `#Q123abc` nor `x#Q123`.
   */
  public static readonly REFERENCE = /(?<![\w#])#Q(\d{1,9})\b/g;

  /**
   * Quests read per query: D1 binds at most 100 parameters.
   */
  protected static readonly CHUNK = 90;

  protected readonly registry = $inject(CommitReferenceRegistry);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly quests = $repository(quests);
  protected readonly mapper = $inject(QuestResourceMapper);

  constructor() {
    this.registry.register((input) => this.record(input));
    this.registry.registerReader((projectId, shas) =>
      this.questsFor(projectId, shas),
    );
  }

  /**
   * The quests whose trail holds each sha (#Q4136), by prefix either way
   * (a trail records 7 to 40 characters): every quest of the project with a
   * trail is read once, so a page of fifty commits costs one query.
   */
  protected async questsFor(
    projectId: number,
    shas: string[],
  ): Promise<Map<string, CommitQuest[]>> {
    const found = new Map<string, CommitQuest[]>(shas.map((sha) => [sha, []]));
    const rows = await this.quests.findMany({
      where: { projectId: { eq: projectId }, commits: { isNotNull: true } },
      columns: [
        "shortId",
        "title",
        "commits",
        "acceptedAt",
        "completedAt",
        "shelvedAt",
        "heldAt",
        "draftAt",
      ],
    });
    const wanted = shas.map((sha) => sha.toLowerCase());
    for (const quest of rows) {
      for (const commit of quest.commits ?? []) {
        const recorded = commit.sha.toLowerCase();
        wanted.forEach((sha, index) => {
          if (!sha.startsWith(recorded) && !recorded.startsWith(sha)) return;
          const list = found.get(shas[index]!)!;
          if (list.some((it) => it.number === quest.shortId)) return;
          list.push({
            number: quest.shortId,
            title: quest.title,
            status: this.mapper.questStatus(quest),
          });
        });
      }
    }
    for (const list of found.values()) list.sort((a, b) => a.number - b.number);
    return found;
  }

  protected async record(
    input: CommitReferenceInput,
  ): Promise<CommitReferenceResult> {
    const byQuest = new Map<number, Array<{ sha: string; message: string }>>();
    for (const commit of input.commits) {
      for (const number of this.references(commit.message)) {
        const list = byQuest.get(number) ?? [];
        list.push(commit);
        byQuest.set(number, list);
      }
    }
    if (byQuest.size === 0) return { quests: [], commits: 0 };

    const numbers = [...byQuest.keys()];
    const rows: Quest[] = [];
    for (let i = 0; i < numbers.length; i += PlanCommitReferences.CHUNK) {
      rows.push(
        ...(await this.quests.findMany({
          where: {
            projectId: { eq: input.projectId },
            shortId: {
              inArray: numbers.slice(i, i + PlanCommitReferences.CHUNK),
            },
          },
        })),
      );
    }

    const at = this.dt.nowISOString();
    const recorded: number[] = [];
    let added = 0;
    for (const quest of rows) {
      const trail = [...(quest.commits ?? [])];
      const known = trail.map((commit) => commit.sha.toLowerCase());
      const fresh: NonNullable<Quest["commits"]> = [];
      for (const commit of byQuest.get(quest.shortId) ?? []) {
        const sha = commit.sha.toLowerCase();
        const seen = known.some(
          (other) => other.startsWith(sha) || sha.startsWith(other),
        );
        if (seen) continue;
        known.push(sha);
        fresh.push({
          sha,
          message: this.subject(commit.message) || undefined,
          repo: input.repo,
          at,
          by: input.userId,
        });
      }
      if (fresh.length === 0) continue;
      await this.quests.updateById(quest.id, { commits: [...trail, ...fresh] });
      await this.audits.quest.logSuccess(
        "commit",
        this.audits.resource("quest", quest, { id: input.userId } as never, {
          shas: fresh.map((commit) => commit.sha),
          pushed: true,
        }),
      );
      recorded.push(quest.shortId);
      added += fresh.length;
    }
    return { quests: recorded.sort((a, b) => a - b), commits: added };
  }

  /**
   * The distinct quest numbers a message names.
   */
  public references(message: string): number[] {
    const found = new Set<number>();
    for (const match of message.matchAll(PlanCommitReferences.REFERENCE)) {
      found.add(Number(match[1]));
    }
    return [...found];
  }

  /**
   * The first line, capped at the trail's 500 characters.
   */
  protected subject(message: string): string {
    return (message.split("\n", 1)[0] ?? "").trim().slice(0, 500);
  }
}
