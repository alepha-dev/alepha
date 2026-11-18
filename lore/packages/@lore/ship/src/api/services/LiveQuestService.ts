import {
  type LiveQuestInstance,
  LiveQuestRegistry,
  type ProjectLiveness,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { deployments } from "../entities/deployments.ts";
import { CommitQuestSetService } from "./CommitQuestSetService.ts";
import { DeployedBuildService } from "./DeployedBuildService.ts";

/**
 * Where a quest's commits run (#E154, folio #F1516): the reads over
 * `commit_quest_sets` and the commit each deployment snapshots.
 *
 * A copy's **live set** is the set of the commit its newest succeeded
 * deployment ran, read the way `DeployedBuildService.latest` reads it. A
 * rollback by either path is therefore right with nothing recomputed.
 *
 * ## An app that declares its paths (#Q3868)
 *
 * In a repository holding several apps, ancestry alone puts every quest on
 * every copy. When the deployed commit has a set kept for the copy's app
 * (the quests of the commits that touched the paths it declares), that set
 * is the live one. The whole-history set stays what "behind" is read
 * against: a done quest merged since the copy's last deploy counts whatever
 * it touched, because which paths a commit touches is only known once a
 * build of it is pushed.
 *
 * ⚠️ **Unknown is never empty.** A copy with no deployment, a deployment with
 * no `commitSha` (from before this epic, or bytes pushed with no commit), or a
 * commit with no set has an unknown set; "behind" and "not live" are never
 * claimed from an unknown or a partial one.
 *
 * ⚠️ D1 refuses more than 100 bound parameters: a set of quest numbers is
 * never bound into a query, membership is tested in memory.
 *
 * Registered as the core registry's reader in its constructor, so Plan reads
 * liveness without importing this.
 */
export class LiveQuestService {
  /**
   * How far back "since" and the per-deployment diff look, like
   * `RollbackService.laterRuns`.
   */
  public static readonly HISTORY = 100;

  protected readonly instances = $repository(appInstances);
  protected readonly runs = $repository(deployments);
  protected readonly builds = $inject(DeployedBuildService);
  protected readonly sets = $inject(CommitQuestSetService);
  protected readonly registry = $inject(LiveQuestRegistry);

  constructor() {
    this.registry.registerReader({
      whereLive: (projectId, number) => this.whereLive(projectId, number),
      projectLiveness: (projectId) => this.projectLiveness(projectId),
    });
  }

  /**
   * The live state of copies of a project: every copy, or the ones named.
   */
  public async states(
    projectId: number,
    instanceIds?: string[],
  ): Promise<InstanceLiveState[]> {
    const rows = await this.instances.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id", "app", "env"],
    });
    const wanted = instanceIds ? new Set(instanceIds) : undefined;
    const copies = rows.filter((row) => !wanted || wanted.has(row.id));
    const builds = await this.builds.latest(copies.map((row) => row.id));
    const sets = await this.sets.setsOf(projectId, [
      ...new Set(
        [...builds.values()].flatMap((build) =>
          build.commitSha ? [build.commitSha] : [],
        ),
      ),
    ]);
    const appSets = await this.sets.appSetsOf(
      projectId,
      copies.flatMap((copy) => {
        const sha = builds.get(copy.id)?.commitSha;
        return sha ? [{ app: copy.app, sha }] : [];
      }),
    );

    return copies.map((copy): InstanceLiveState => {
      const base = { instanceId: copy.id, app: copy.app, env: copy.env };
      const build = builds.get(copy.id);
      if (!build) {
        return { ...base, state: "unknown", reason: "never-deployed" };
      }
      const run = {
        ...base,
        deploymentId: build.deploymentId,
        dirty: build.dirty === true,
        ...(build.finishedAt ? { at: build.finishedAt } : {}),
      };
      if (!build.commitSha) {
        return { ...run, state: "unknown", reason: "no-commit" };
      }
      const whole = sets.get(build.commitSha.toLowerCase());
      const scoped = appSets.get(
        CommitQuestSetService.appKey(copy.app, build.commitSha),
      );
      const set = scoped ?? whole;
      if (!set) {
        return {
          ...run,
          commitSha: build.commitSha,
          state: "unknown",
          reason: "no-set",
        };
      }
      return {
        ...run,
        commitSha: build.commitSha,
        numbers: set.numbers,
        ...(scoped ? { scoped: true } : {}),
        ...(whole?.complete ? { merged: whole.numbers } : {}),
        state: set.complete ? "known" : "partial",
        ...(set.complete ? {} : { reason: "partial" as const }),
      };
    });
  }

  /**
   * The copies running a quest's commits, with `dirty` and `since`.
   */
  public async whereLive(
    projectId: number,
    number: number,
  ): Promise<LiveQuestInstance[]> {
    return (await this.questLiveness(projectId, number)).instances;
  }

  /**
   * {@link whereLive}, with whether every deployed copy's set is known: one
   * read of the copies for both.
   */
  public async questLiveness(
    projectId: number,
    number: number,
  ): Promise<{ instances: LiveQuestInstance[]; settled: boolean }> {
    const states = await this.states(projectId);
    const carrying = states.filter((state) => state.numbers?.has(number));
    const live: LiveQuestInstance[] = [];
    for (const state of carrying) {
      const since = await this.since(projectId, state, number);
      live.push({
        instanceId: state.instanceId,
        app: state.app,
        env: state.env,
        dirty: state.dirty === true,
        ...(since ? { since } : {}),
      });
    }
    return { instances: live, settled: this.settled(states) };
  }

  /**
   * A copy Lore never deployed (an app it only hears from) has no liveness
   * at all and is out of scope; every copy it HAS deployed must be known for
   * "not live anywhere" to be claimed.
   */
  protected settled(states: InstanceLiveState[]): boolean {
    return states.every(
      (state) => state.reason === "never-deployed" || state.state === "known",
    );
  }

  /**
   * Every copy's live set at once, for a list of quests: one read of the
   * newest runs and one of their sets, whatever the number of quests.
   */
  public async projectLiveness(projectId: number): Promise<ProjectLiveness> {
    const states = await this.states(projectId);
    const live = new Map<number, LiveQuestInstance[]>();
    for (const state of states) {
      for (const n of state.numbers ?? []) {
        const entry: LiveQuestInstance = {
          instanceId: state.instanceId,
          app: state.app,
          env: state.env,
          dirty: state.dirty === true,
        };
        const list = live.get(n);
        if (list) {
          list.push(entry);
        } else {
          live.set(n, [entry]);
        }
      }
    }
    return { live, settled: this.settled(states) };
  }

  /**
   * One copy: its live set, what it is behind, and what each of its recent
   * succeeded deployments put live and took down.
   */
  public async instance(
    projectId: number,
    instanceId: string,
  ): Promise<InstanceLiveDetail | undefined> {
    const [state] = await this.states(projectId, [instanceId]);
    if (!state) {
      return undefined;
    }
    const history = await this.history(projectId, state);
    const runs = history.runs.map((run, i): InstanceRunDiff => {
      const previous = history.runs[i + 1];
      const set = run.numbers;
      const before = previous?.numbers;
      if (!previous) {
        // The oldest run read: nothing to compare with.
        return { deploymentId: run.id, known: false };
      }
      if (!set || !before || run.paths !== previous.paths) {
        // No set, or two sets that answer different questions: one walked
        // with the app's paths and one over the whole history, or with
        // other paths. Their difference is not what the run changed.
        return { deploymentId: run.id, known: false };
      }
      return {
        deploymentId: run.id,
        known: run.complete && previous.complete,
        added: [...set].filter((n) => !before.has(n)).sort((a, b) => a - b),
        removed: [...before].filter((n) => !set.has(n)).sort((a, b) => a - b),
      };
    });

    let behind: number[] | undefined;
    if (state.merged) {
      const merged = state.merged;
      behind = (await this.registry.recordedCommits(projectId))
        .filter((quest) => quest.completed && !merged.has(quest.number))
        .map((quest) => quest.number)
        .sort((a, b) => a - b);
    }

    return {
      ...state,
      live: state.numbers
        ? [...state.numbers].sort((a, b) => a - b)
        : undefined,
      behind,
      runs,
    };
  }

  /**
   * How many done quests each copy does not run yet, for the Apps list: one
   * read of the copies' newest runs, one of their sets and one of the
   * recorded commits, whatever the number of rows (#Q2682 timed out doing
   * otherwise). Only copies whose commit has a complete whole-history set
   * are in the map: an unknown or partial one has no count, never zero.
   */
  public async behindCounts(
    projectId: number,
    instanceIds: string[],
  ): Promise<Map<string, number>> {
    const known = (await this.states(projectId, instanceIds)).filter(
      (state) => state.merged,
    );
    if (known.length === 0) {
      return new Map();
    }
    const done = (await this.registry.recordedCommits(projectId))
      .filter((quest) => quest.completed)
      .map((quest) => quest.number);
    return new Map(
      known.map((state) => [
        state.instanceId,
        done.filter((n) => !state.merged?.has(n)).length,
      ]),
    );
  }

  /**
   * The finish time of the oldest deployment in the newest unbroken run of
   * succeeded deployments carrying the quest, bounded at {@link HISTORY}.
   */
  protected async since(
    projectId: number,
    copy: { instanceId: string; app: string },
    number: number,
  ): Promise<string | undefined> {
    const { runs } = await this.history(projectId, copy);
    let since: string | undefined;
    for (const run of runs) {
      if (!run.numbers?.has(number)) {
        break;
      }
      since = run.finishedAt ?? run.createdAt;
    }
    return since;
  }

  /**
   * A copy's newest succeeded runs, newest first, each with its commit's
   * set: the one kept for the copy's app when there is one, the
   * whole-history one otherwise, as {@link states} reads the live set.
   */
  protected async history(
    projectId: number,
    copy: { instanceId: string; app: string },
  ): Promise<{ runs: HistoryRun[] }> {
    const rows = await this.runs.findMany({
      where: {
        projectId: { eq: projectId },
        instanceId: { eq: copy.instanceId },
        status: { eq: "succeeded" },
      },
      columns: ["id", "commitSha", "finishedAt", "createdAt"],
      orderBy: [{ column: "createdAt", direction: "desc" }],
      limit: LiveQuestService.HISTORY,
    });
    const shas = [
      ...new Set(rows.flatMap((row) => (row.commitSha ? [row.commitSha] : []))),
    ];
    const sets = await this.sets.setsOf(projectId, shas);
    const appSets = await this.sets.appSetsOf(
      projectId,
      shas.map((sha) => ({ app: copy.app, sha })),
    );
    return {
      runs: rows.map((row) => {
        const scoped = row.commitSha
          ? appSets.get(CommitQuestSetService.appKey(copy.app, row.commitSha))
          : undefined;
        const set =
          scoped ??
          (row.commitSha ? sets.get(row.commitSha.toLowerCase()) : undefined);
        return {
          id: row.id,
          createdAt: row.createdAt,
          ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
          ...(set ? { numbers: set.numbers } : {}),
          complete: set?.complete === true,
          paths: scoped?.paths ?? "",
        };
      }),
    };
  }
}

interface HistoryRun {
  id: string;
  createdAt: string;
  finishedAt?: string;
  numbers?: Set<number>;
  complete: boolean;
  /**
   * The paths the set was walked with, or `""` for the whole history.
   */
  paths: string;
}

/**
 * Why a copy's set is not known: it never deployed, its run carries no
 * commit, the commit has no set, or the set is partial.
 */
export type LiveSetReason =
  | "never-deployed"
  | "no-commit"
  | "no-set"
  | "partial";

export interface InstanceLiveState {
  instanceId: string;
  app: string;
  env: string;
  /**
   * `known` is a complete set; `partial` one resting on an incomplete
   * history; `unknown` no set at all.
   */
  state: "known" | "partial" | "unknown";
  reason?: LiveSetReason;
  deploymentId?: string;
  commitSha?: string;
  dirty?: boolean;
  /**
   * When the current deployment finished.
   */
  at?: string;
  /**
   * The live set: the quests of the commits that touched the app's paths
   * when {@link scoped}, every quest in the commit's history otherwise.
   */
  numbers?: Set<number>;
  /**
   * The live set was walked with the paths the app declares (#Q3868).
   */
  scoped?: boolean;
  /**
   * Every quest in the deployed commit's history, whatever it touched, and
   * only when that set is complete: what "behind" is read against.
   */
  merged?: Set<number>;
}

export interface InstanceRunDiff {
  deploymentId: string;
  /**
   * Both sets known and complete. A diff against a partial set is shown
   * with care, and none is claimed against an unknown one.
   */
  known: boolean;
  added?: number[];
  removed?: number[];
}

export interface InstanceLiveDetail extends InstanceLiveState {
  live?: number[];
  /**
   * The project's completed quests with at least one recorded commit, minus
   * the live set. Only for a known set.
   */
  behind?: number[];
  runs: InstanceRunDiff[];
}
