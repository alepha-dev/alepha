import {
  type PullRequestChange,
  PullRequestStateService,
  type PushChange,
} from "@lore/core/api";
import { $hook, $inject } from "alepha";
import { identities } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { appendPullRequests } from "../schemas/pullRequestSchema.ts";
import { WorkEventSources } from "./WorkEventSources.ts";

/**
 * Commits and pull requests attach themselves to the quests and epics they
 * name (#Q4367, epic #E177).
 *
 * - **A pull request** whose title, body or head branch names `#Q<n>` or
 *   `#E<n>` (the typed forms only, [[#E32]]: a bare `#12` attaches nothing),
 *   or whose head branch is `lore/q<n>` (an agent job's write branch), is
 *   attached to that quest or epic through `WorkEventSources.addPullRequest`,
 *   so the trail and `pull_request.added` behave exactly as when an agent
 *   records it. A backfill at connect attaches silently (the epic review's
 *   answer to item 26).
 * - **A push to the default branch** attaches each commit naming `#Q<n>` to
 *   that quest's commit trail, with the dedupe of `quest_commit_add`. Ship's
 *   commit quest sets stay `lore commits push`'s.
 *
 * Never automatic here: completing or reopening a quest from a merge.
 */
export class PlanGitHubTrail {
  /**
   * `#Q12`, `#E3`, never `#12`; not inside a longer word.
   */
  public static readonly REFERENCE = /(?<![\w#])#([QE])(\d{1,7})\b/g;

  /**
   * An agent job's quest branch, `lore/q<n>` (`AgentJobService.start`).
   */
  public static readonly QUEST_BRANCH = /^lore\/q(\d{1,7})$/i;

  protected readonly states = $inject(PullRequestStateService);
  protected readonly sources = $inject(WorkEventSources);
  protected readonly quests = $repository(quests);
  protected readonly epics = $repository(epics);
  protected readonly identities = $repository(identities);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.states.onPullRequest((change) => this.pullRequest(change));
      this.states.onPush((change) => this.push(change));
    },
  });

  /**
   * The quest and epic numbers a pull request names.
   */
  references(input: { title?: string; body?: string; branch?: string }): {
    quests: number[];
    epics: number[];
  } {
    const quests = new Set<number>();
    const epics = new Set<number>();
    for (const text of [input.title, input.body, input.branch]) {
      for (const match of (text ?? "").matchAll(PlanGitHubTrail.REFERENCE)) {
        (match[1] === "Q" ? quests : epics).add(Number(match[2]));
      }
    }
    const branch = PlanGitHubTrail.QUEST_BRANCH.exec(input.branch ?? "");
    if (branch) quests.add(Number(branch[1]));
    return { quests: [...quests].slice(0, 20), epics: [...epics].slice(0, 20) };
  }

  /**
   * The project member behind a GitHub user, by GitHub's numeric id (a
   * login can be renamed), through their linked GitHub sign-in.
   */
  async memberOf(
    githubUserId: number | undefined,
  ): Promise<string | undefined> {
    if (githubUserId === undefined) return undefined;
    const [identity] = await this.identities.findMany({
      where: {
        provider: { eq: "github" },
        providerUserId: { eq: String(githubUserId) },
      },
      limit: 1,
    });
    return identity?.userId;
  }

  protected async pullRequest(change: PullRequestChange): Promise<void> {
    // Attach on what can change the references: the pull request itself,
    // never a check or a status.
    if (change.event !== "pull_request" && !change.silent) return;
    const refs = this.references({
      title: change.row.title,
      ...(change.body ? { body: change.body } : {}),
      branch: change.row.headRef,
    });
    if (refs.quests.length === 0 && refs.epics.length === 0) return;
    const by = await this.memberOf(change.row.authorGithubId);
    const at = this.dateTime.nowISOString();
    const record = {
      url: change.row.url,
      number: change.row.number,
      repo: change.row.repository,
      title: change.row.title,
    };
    const projectId = change.connection.projectId;
    if (refs.quests.length > 0) {
      const rows = await this.quests.findMany({
        where: {
          projectId: { eq: projectId },
          shortId: { inArray: refs.quests },
        },
      });
      for (const quest of rows) {
        const trail = appendPullRequests(
          quest.pullRequests,
          [record],
          by,
          at,
          "github",
        );
        if (trail.length === (quest.pullRequests ?? []).length) continue;
        await this.sources.addPullRequest(
          { kind: "quest", row: quest },
          trail,
          record.url,
          by,
          { silent: change.silent === true },
        );
      }
    }
    if (refs.epics.length > 0) {
      const rows = await this.epics.findMany({
        where: {
          projectId: { eq: projectId },
          number: { inArray: refs.epics },
        },
      });
      for (const epic of rows) {
        const trail = appendPullRequests(
          epic.pullRequests,
          [record],
          by,
          at,
          "github",
        );
        if (trail.length === (epic.pullRequests ?? []).length) continue;
        await this.sources.addPullRequest(
          { kind: "epic", row: epic },
          trail,
          record.url,
          by,
          { silent: change.silent === true },
        );
      }
    }
  }

  protected async push(change: PushChange): Promise<void> {
    if (change.ref !== `refs/heads/${change.connection.defaultBranch}`) return;
    const byQuest = new Map<number, Array<{ sha: string; message: string }>>();
    for (const commit of change.commits) {
      const subject = commit.message.split("\n")[0]?.slice(0, 500) ?? "";
      for (const match of commit.message.matchAll(PlanGitHubTrail.REFERENCE)) {
        if (match[1] !== "Q") continue;
        const shortId = Number(match[2]);
        const list = byQuest.get(shortId) ?? [];
        list.push({ sha: commit.sha.toLowerCase(), message: subject });
        byQuest.set(shortId, list);
      }
    }
    if (byQuest.size === 0) return;
    const rows = await this.quests.findMany({
      where: {
        projectId: { eq: change.connection.projectId },
        shortId: { inArray: [...byQuest.keys()].slice(0, 100) },
      },
    });
    const at = this.dateTime.nowISOString();
    const repo = `${change.connection.owner}/${change.connection.name}`;
    for (const quest of rows) {
      const commits = this.appendCommits(
        quest,
        byQuest.get(quest.shortId) ?? [],
        repo,
        at,
      );
      if (!commits) continue;
      await this.quests.updateById(quest.id, { commits });
    }
  }

  /**
   * The quest's trail with these commits, deduped on the sha as
   * `quest_commit_add` does; undefined when nothing is new.
   */
  protected appendCommits(
    quest: Quest,
    incoming: Array<{ sha: string; message: string }>,
    repo: string,
    at: string,
  ): Quest["commits"] | undefined {
    const trail = [...(quest.commits ?? [])];
    const seen = new Set(trail.map((commit) => commit.sha.toLowerCase()));
    let added = false;
    for (const commit of incoming) {
      if (seen.has(commit.sha)) continue;
      seen.add(commit.sha);
      trail.push({
        sha: commit.sha,
        ...(commit.message ? { message: commit.message } : {}),
        repo,
        at,
        source: "github",
      });
      added = true;
    }
    return added ? trail : undefined;
  }
}
