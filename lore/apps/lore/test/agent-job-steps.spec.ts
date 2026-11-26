import {
  AgentJobSteps,
  HostCommandTransport,
  HostJobService,
} from "@lore/core/api";
import { JobTools } from "@lore/core/mcp";
import {
  type Host,
  type HostJob,
  hostJobs,
  hosts,
  jobKeys,
} from "@lore/core/schemas";
import { createTestProject, ReadCounter } from "@lore/core/testing";
import { QuestTools } from "@lore/plan/mcp";
import { quests } from "@lore/plan/schemas";
import { createTestEpic, createTestQuest } from "@lore/plan/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

class Repos {
  keys = $repository(jobKeys);
  hosts = $repository(hosts);
  jobs = $repository(hostJobs);
  quests = $repository(quests);
}

/**
 * Every push answers "connected".
 */
class ConnectedTransport extends HostCommandTransport {
  override async push(_host: Host, _frame: unknown): Promise<boolean> {
    return true;
  }
}

/**
 * The job queue, with its end reachable from the spec.
 */
class TestHostJobService extends HostJobService {
  public finish(jobId: string): Promise<HostJob> {
    return this.end(jobId, { status: "succeeded" });
  }
}

/**
 * A quest keeps the job that worked it, and a job's steps are read from its
 * quests (#Q4433, epic #E181): accepted, ticked, completed and handed back,
 * read while the job runs and fixed at its end.
 */
describe("an agent job's steps", () => {
  let alepha: Alepha;
  let repos: Repos;
  let tools: QuestTools;
  let jobTools: JobTools;
  let service: TestHostJobService;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let ownerId: string;
  let host: Host;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with({ provide: HostCommandTransport, use: ConnectedTransport });
    alepha.with({ provide: HostJobService, use: TestHostJobService });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaMcp);
    alepha.with(ReadCounter);
    bootLore(alepha, ["api", "mcp"]);
    repos = alepha.inject(Repos);
    alepha.inject(TestEntityRepositories);
    tools = alepha.inject(QuestTools);
    jobTools = alepha.inject(JobTools);
    service = alepha.inject(HostJobService) as TestHostJobService;
    await alepha.start();
    project = await createTestProject(alepha, { title: "Acme" });
    ownerId = project.createdBy!;
    host = await repos.hosts.create({
      projectId: project.id,
      ownerUserId: ownerId,
      type: "bay",
      slug: "nfo1",
    });
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const now = () => alepha.inject(DateTimeProvider).nowMillis();

  /**
   * A running job and the key it works under.
   */
  const job = async (
    prompt: string,
    args: Array<{ name: string; type: "epic"; value: string }> = [],
  ) => {
    const id = crypto.randomUUID();
    const apiKeyId = crypto.randomUUID();
    const startedAt = new Date(now() - 60_000).toISOString();
    await repos.jobs.create({
      id,
      projectId: project.id,
      hostId: host.id,
      kind: "agent",
      status: "running",
      input: { agent: "claude", timeoutSeconds: 600 },
      prompt,
      args,
      queuedAt: startedAt,
      startedAt,
    });
    await repos.keys.create({
      apiKeyId,
      jobId: id,
      projectId: project.id,
      userId: ownerId,
      expiresAt: new Date(now() + 60_000).toISOString(),
    });
    return { id, apiKeyId };
  };

  const as = <R>(apiKeyId: string | undefined, fn: () => Promise<R>) =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: ownerId, roles: ["user"] });
      alepha.store.set("alepha.http.request", {
        user: {
          id: ownerId,
          roles: ["user"],
          ...(apiKeyId
            ? { credential: { type: "api-key", id: apiKeyId } }
            : {}),
        },
      } as never);
      return fn();
    });

  const accept = (shortId: number, apiKeyId?: string) =>
    as(apiKeyId, () =>
      tools.quest_accept.execute({ project: project.id, shortId }),
    );
  const tick = (shortId: number, objectiveId: number, apiKeyId?: string) =>
    as(apiKeyId, () =>
      tools.quest_objective_set.execute({
        project: project.id,
        shortId,
        objectiveId,
        completed: true,
      }),
    );
  const complete = (shortId: number, apiKeyId?: string) =>
    as(apiKeyId, () =>
      tools.quest_complete.execute({ project: project.id, shortId }),
    );
  const stepsOf = async (jobId: string) =>
    (
      (await as(undefined, () => jobTools.job_get.execute({ id: jobId }))) as {
        steps?: {
          unit: string;
          total: number;
          done: number;
          quests: Array<{
            shortId: number;
            completedAt?: string;
            objectives: { total: number; done: number; waived: number };
          }>;
          pending: Array<{ shortId: number }>;
          current?: number;
          lastStepAt?: string;
          stepTimes: string[];
        };
      }
    ).steps;
  const objectives = [
    { id: 0, title: "one", completed: false },
    { id: 1, title: "two", completed: false },
  ];

  it("keeps the job that accepted a quest, and a member's accept or complete never clears it", async ({
    expect,
  }) => {
    const run = await job("work-loose-quests");
    const quest = await createTestQuest(alepha, project);
    await accept(quest.shortId, run.apiKeyId);
    const row = () => repos.quests.getOne({ where: { id: { eq: quest.id } } });
    expect((await row()).workedByJobId).toBe(run.id);
    // A member takes it over and completes it: the stamp of who worked it
    // stays, the liveness one goes.
    await as(undefined, () =>
      tools.quest_unassign.execute({
        project: project.id,
        shortId: quest.shortId,
      }),
    );
    expect((await row()).workedByJobId).toBe(run.id);
    await accept(quest.shortId);
    expect((await row()).agentJobId).toBeUndefined();
    expect((await row()).workedByJobId).toBe(run.id);
    await complete(quest.shortId);
    expect((await row()).workedByJobId).toBe(run.id);
    // A member's own accept of a quest no job touched stamps nothing.
    const other = await createTestQuest(alepha, project);
    await accept(other.shortId);
    expect(
      (await repos.quests.getOne({ where: { id: { eq: other.id } } }))
        .workedByJobId,
    ).toBeUndefined();
  });

  it("counts a job accepting, ticking, completing and handing back, live and after its end, on job_get and job_list", async ({
    expect,
  }) => {
    const run = await job("work-loose-quests");
    const first = await createTestQuest(alepha, project, { objectives });
    const second = await createTestQuest(alepha, project, { objectives });
    const third = await createTestQuest(alepha, project);
    await accept(first.shortId, run.apiKeyId);
    await accept(second.shortId, run.apiKeyId);
    await accept(third.shortId, run.apiKeyId);
    await tick(first.shortId, 0, run.apiKeyId);
    await tick(first.shortId, 1, run.apiKeyId);
    await complete(first.shortId, run.apiKeyId);
    await tick(second.shortId, 0, run.apiKeyId);
    // Handed back: it stays a step, not done.
    await as(undefined, () =>
      tools.quest_unassign.execute({
        project: project.id,
        shortId: third.shortId,
      }),
    );

    const live = await stepsOf(run.id);
    expect(live).toMatchObject({
      unit: "quest",
      total: 3,
      done: 1,
      current: second.shortId,
      pending: [],
    });
    expect(live?.quests.map((it) => it.shortId)).toEqual([
      first.shortId,
      second.shortId,
      third.shortId,
    ]);
    expect(live?.quests[0]?.objectives).toEqual({
      total: 2,
      done: 2,
      waived: 0,
    });
    expect(live?.quests[1]?.objectives.done).toBe(1);
    expect(live?.quests[2]?.completedAt).toBeUndefined();
    expect(live?.stepTimes).toHaveLength(1);
    expect(live?.lastStepAt).toBeDefined();

    // On the list too, in one read for every row.
    const listed = (await as(undefined, () =>
      jobTools.job_list.execute({ project: project.id }),
    )) as { jobs: Array<{ id: string; steps?: { done: number } }> };
    expect(listed.jobs.find((it) => it.id === run.id)?.steps?.done).toBe(1);

    // Ended: the count is kept on the row, and another job taking over the
    // quest it handed back no longer moves it.
    await service.finish(run.id);
    const ended = await repos.jobs.getOne({ where: { id: { eq: run.id } } });
    expect(ended.steps).toMatchObject({ total: 3, done: 1 });
    const next = await job("work-loose-quests");
    await accept(third.shortId, next.apiKeyId);
    await complete(third.shortId, next.apiKeyId);
    expect(await stepsOf(run.id)).toMatchObject({ total: 3, done: 1 });
    expect(await stepsOf(next.id)).toMatchObject({ total: 1, done: 1 });
  });

  it("carries the pace and the ceiling warning once 2 quests are done, on job_get (#Q4436)", async ({
    expect,
  }) => {
    const run = await job("work-loose-quests");
    const quests = [];
    for (let index = 0; index < 3; index += 1) {
      const quest = await createTestQuest(alepha, project);
      await accept(quest.shortId, run.apiKeyId);
      quests.push(quest);
    }
    const read = async () =>
      (await as(undefined, () => jobTools.job_get.execute({ id: run.id }))) as {
        pace?: { left: number; low: number; high: number; warning: boolean };
      };
    await complete(quests[0]!.shortId, run.apiKeyId);
    expect((await read()).pace).toBeUndefined();
    await complete(quests[1]!.shortId, run.apiKeyId);
    // A 10 minute ceiling: a minute in, plus the 30 minute allowance.
    expect((await read()).pace).toMatchObject({ left: 1, warning: true });
    await service.finish(run.id);
    expect((await read()).pace).toBeUndefined();
  });

  it("leaves out of a work-quest job's pace the objectives ticked before it started (#Q4436)", async ({
    expect,
  }) => {
    const run = await job("work-quest");
    const before = new Date(now() - 3_600_000).toISOString();
    const quest = await createTestQuest(alepha, project, {
      objectives: Array.from({ length: 6 }, (_, id) => ({
        id,
        title: `step ${id}`,
        completed: id < 2,
      })),
      history: [0, 1].map((objectiveId) => ({
        at: before,
        by: ownerId,
        action: "objective_completed" as const,
        objectiveId,
      })),
    });
    await accept(quest.shortId, run.apiKeyId);
    await tick(quest.shortId, 2, run.apiKeyId);
    await tick(quest.shortId, 3, run.apiKeyId);
    const read = (await as(undefined, () =>
      jobTools.job_get.execute({ id: run.id }),
    )) as { steps?: { done: number }; pace?: { left: number } };
    expect(read.steps?.done).toBe(4);
    expect(read.pace?.left).toBe(2);
  });

  it("gives a work-epic job its epic's quests not shelved and not done before it started, the rest pending", async ({
    expect,
  }) => {
    const epic = await createTestEpic(alepha, project, {
      status: "in_progress",
    });
    const doneBefore = await createTestQuest(alepha, project, {
      epicId: epic.id,
      completedAt: new Date(now() - 3_600_000).toISOString(),
    });
    const shelved = await createTestQuest(alepha, project, {
      epicId: epic.id,
      shelvedAt: new Date(now() - 3_600_000).toISOString(),
    });
    const worked = await createTestQuest(alepha, project, { epicId: epic.id });
    const left = await createTestQuest(alepha, project, { epicId: epic.id });
    await createTestQuest(alepha, project);
    const run = await job("work-epic", [
      { name: "epic", type: "epic", value: String(epic.number) },
    ]);
    await accept(worked.shortId, run.apiKeyId);

    const steps = await stepsOf(run.id);
    expect(steps).toMatchObject({
      unit: "quest",
      total: 2,
      done: 0,
      current: worked.shortId,
    });
    expect(steps?.quests.map((it) => it.shortId)).toEqual([worked.shortId]);
    expect(steps?.pending.map((it) => it.shortId)).toEqual([left.shortId]);
    expect(
      steps?.pending.some(
        (it) =>
          it.shortId === doneBefore.shortId || it.shortId === shelved.shortId,
      ),
    ).toBe(false);
  });

  it("counts a work-quest job's objectives as its steps", async ({
    expect,
  }) => {
    const run = await job("work-quest");
    const quest = await createTestQuest(alepha, project, {
      objectives: [...objectives, { id: 2, title: "three", completed: false }],
    });
    await accept(quest.shortId, run.apiKeyId);
    await tick(quest.shortId, 1, run.apiKeyId);
    await tick(quest.shortId, 0, run.apiKeyId);
    expect(await stepsOf(run.id)).toMatchObject({
      unit: "objective",
      total: 3,
      done: 2,
      current: quest.shortId,
    });
    expect((await stepsOf(run.id))?.stepTimes).toHaveLength(2);
  });

  it("reads the steps of a list of jobs in one query of the quests, whatever its length", async ({
    expect,
  }) => {
    const runs = [];
    for (let index = 0; index < 4; index += 1) {
      const run = await job("work-loose-quests");
      const quest = await createTestQuest(alepha, project);
      await accept(quest.shortId, run.apiKeyId);
      runs.push(run);
    }
    const rows = await repos.jobs.findMany({
      where: { id: { inArray: runs.map((run) => run.id) } },
    });
    const counter = alepha.inject(ReadCounter);
    counter.reset();
    const one = await service.stepsOf(rows.slice(0, 1));
    const once = counter.of("quests");
    counter.reset();
    const all = await service.stepsOf(rows);
    expect(one.size).toBe(1);
    expect(all.size).toBe(4);
    expect(once).toBe(1);
    expect(counter.of("quests")).toBe(1);
    // An ended job with no count kept is not read again: the list of them
    // grows with the project, and D1 binds 100 parameters at most.
    const ended = rows.map((row) => ({ ...row, status: "succeeded" as const }));
    counter.reset();
    expect((await service.stepsOf(ended)).size).toBe(0);
    expect(counter.of("quests")).toBe(0);
  });

  it("carries no steps for a job that accepted no quest", async ({
    expect,
  }) => {
    const run = await job("triage");
    expect(await stepsOf(run.id)).toBeUndefined();
    await service.finish(run.id);
    expect(
      (await repos.jobs.getOne({ where: { id: { eq: run.id } } })).steps,
    ).toBeUndefined();
    expect(alepha.inject(AgentJobSteps).available).toBe(true);
  });
});
