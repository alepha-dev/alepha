import { CommitReferenceRegistry, LoreAudits } from "@lore/core/api";
import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import type { UserAccountToken } from "alepha/security";

import { GitBackend, type GitCommit } from "../backends/GitBackend.ts";
import type { CodeRepository } from "../entities/codeRepositories.ts";
import { CodeIndexJobs } from "../jobs/CodeIndexJobs.ts";
import { CodeCommitIndex } from "./CodeCommitIndex.ts";
import { type GitRefCommand, GitReceivePack } from "./GitReceivePack.ts";

/**
 * What a push records once the backend has accepted it (#Q3945): its
 * commits on the quests they name, and a `code:push` row in the project's
 * activity.
 *
 * Hooked at the proxy, on both backends, by the git route: it reads the
 * receive-pack response as it streams to the client and runs when the
 * response ends, so the push is already done and the client waits only for
 * the recording. No Queue, no Artifacts event subscription.
 *
 * - Only branch updates count: `refs/heads/*` with an old and a new id, and
 *   only the ones the backend reported `ok`. A branch's creation records
 *   nothing (the default branch's first push carries the whole history), nor
 *   does a deletion.
 * - **An import records nothing** (#E162 decision 11): a push marked
 *   `lore-import` writes its activity row and links no commit.
 * - Best effort: a failure is logged and never turns the push red, which
 *   has landed already.
 * - **The commit index** (#Q4132) learns every branch a push created or
 *   moved, an import's included, inline up to a cap and by job beyond.
 */
export class CodePushRecorder {
  /**
   * The most commits one ref update records. A larger push records none
   * (`GitBackend.commits`).
   */
  public static readonly LIMIT = 1000;

  /**
   * The most response bytes kept to read the report: a report is a line per
   * ref, and side-band progress is a few kilobytes.
   */
  public static readonly RESPONSE_LIMIT = 1024 * 1024;

  protected readonly log = $logger();
  protected readonly backend = $inject(GitBackend);
  protected readonly receivePack = $inject(GitReceivePack);
  protected readonly references = $inject(CommitReferenceRegistry);
  protected readonly audits = $inject(LoreAudits);
  protected readonly index = $inject(CodeCommitIndex);
  protected readonly indexJobs = $inject(CodeIndexJobs);

  /**
   * The response body, passed through unchanged, with the recording run at
   * its end.
   */
  public watch(
    body: ReadableStream<Uint8Array>,
    push: CodePush,
  ): ReadableStream<Uint8Array> {
    const kept: Uint8Array[] = [];
    let size = 0;
    return body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          if (size < CodePushRecorder.RESPONSE_LIMIT) {
            kept.push(chunk);
            size += chunk.length;
          }
          controller.enqueue(chunk);
        },
        flush: async () => {
          const response = new Uint8Array(size);
          let offset = 0;
          for (const chunk of kept) {
            response.set(chunk, offset);
            offset += chunk.length;
          }
          await this.record(push, response).catch((error) =>
            this.log.warn("Could not record a push", {
              repository: push.repository.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        },
      }),
    );
  }

  public async record(push: CodePush, response: Uint8Array): Promise<void> {
    const accepted = this.receivePack.acceptedRefs(response, push.capabilities);
    const updated = push.commands.filter((command) =>
      accepted.has(command.ref),
    );
    if (updated.length === 0) return;

    const imported = push.pushOptions.includes("lore-import");
    const commits = new Map<string, GitCommit>();
    if (!imported) {
      for (const command of updated) {
        if (
          !command.ref.startsWith("refs/heads/") ||
          command.oldId === GitReceivePack.ZERO ||
          command.newId === GitReceivePack.ZERO
        ) {
          continue;
        }
        const listed = await this.backend.commits(push.repository.backendRef, {
          from: command.oldId,
          to: command.newId,
          limit: CodePushRecorder.LIMIT,
        });
        for (const commit of listed) commits.set(commit.sha, commit);
      }
    }

    const result = await this.references.record({
      projectId: push.repository.projectId,
      userId: push.user.id,
      repo: push.repoPath,
      commits: [...commits.values()],
    });

    await this.indexPush(push, updated, imported).catch((error) =>
      this.log.warn("Could not index a push", {
        repository: push.repository.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    await this.audits.code.logSuccess("push", {
      ...this.audits.actor(push.user),
      ...this.audits.scope(push.repository.projectId),
      resourceType: "code",
      resourceId: push.repository.slug,
      description: push.repoPath,
      metadata: {
        refs: updated.map((command) => command.ref),
        commits: commits.size,
        quests: result.quests,
        ...(imported ? { import: true } : {}),
      },
    });
  }

  /**
   * The commit index of a push (#Q4132): every branch it created or
   * moved, all parents walked, at most {@link CodeCommitIndex.PUSH_INLINE}
   * commits before the push answers. The rest, and an import, go to the
   * backfill job, which resumes from the frontier the walk left.
   */
  protected async indexPush(
    push: CodePush,
    updated: GitRefCommand[],
    imported: boolean,
  ): Promise<void> {
    const tips = updated
      .filter(
        (command) =>
          command.ref.startsWith("refs/heads/") &&
          command.newId !== GitReceivePack.ZERO,
      )
      .map((command) => command.newId);
    if (tips.length === 0) return;
    if (imported) {
      await this.indexJobs.start(push.repository.id);
      return;
    }
    const result = await this.index.walk(
      push.repository,
      tips,
      CodeCommitIndex.PUSH_INLINE,
    );
    if (result.remaining) await this.indexJobs.start(push.repository.id);
  }
}

export interface CodePush {
  repository: CodeRepository;
  /**
   * `<project>/<repo>`, for the quest trail and the activity row.
   */
  repoPath: string;
  user: UserAccountToken;
  commands: GitRefCommand[];
  capabilities: string[];
  pushOptions: string[];
}
