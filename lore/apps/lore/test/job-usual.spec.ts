import { JobTools } from "@lore/core/mcp";
import { hostJobs, hosts } from "@lore/core/schemas";
import { createTestProject } from "@lore/core/testing";
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
  hosts = $repository(hosts);
  jobs = $repository(hostJobs);
}

/**
 * A job with no steps reads how long its prompt usually takes (#Q4435,
 * epic #E181): the last 20 succeeded runs of the same project, prompt,
 * prompt text (its hash) and model, under 5 of them nothing.
 */
describe("how long a prompt usually takes", () => {
  let alepha: Alepha;
  let repos: Repos;
  let jobTools: JobTools;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let ownerId: string;
  let hostId: string;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaMcp);
    bootLore(alepha, ["api", "mcp"]);
    repos = alepha.inject(Repos);
    alepha.inject(TestEntityRepositories);
    jobTools = alepha.inject(JobTools);
    await alepha.start();
    project = await createTestProject(alepha, { title: "Acme" });
    ownerId = project.createdBy!;
    hostId = (
      await repos.hosts.create({
        projectId: project.id,
        ownerUserId: ownerId,
        type: "bay",
        slug: "nfo1",
      })
    ).id;
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const now = () => alepha.inject(DateTimeProvider).nowMillis();
  const iso = (minutesAgo: number) =>
    new Date(now() - minutesAgo * 60_000).toISOString();

  const job = (over: {
    status: "running" | "succeeded" | "timed_out";
    seconds?: number;
    hash?: string;
    model?: string;
    prompt?: string;
    ago?: number;
  }) => {
    const ago = over.ago ?? 60;
    const started = iso(ago);
    return repos.jobs.create({
      projectId: project.id,
      hostId,
      kind: "agent",
      status: over.status,
      input: {
        agent: "claude",
        timeoutSeconds: 600,
        ...(over.model ? { model: over.model } : {}),
      },
      prompt: over.prompt ?? "triage",
      ...(over.hash === undefined ? {} : { promptHash: over.hash }),
      queuedAt: started,
      startedAt: started,
      ...(over.status === "running"
        ? {}
        : {
            endedAt: new Date(
              Date.parse(started) + (over.seconds ?? 60) * 1000,
            ).toISOString(),
          }),
    });
  };

  const usualOf = async (jobId: string) =>
    (
      (await alepha.context.run(() => {
        alepha.store.set(currentUserAtom, { id: ownerId, roles: ["user"] });
        return jobTools.job_get.execute({ id: jobId });
      })) as {
        usual?: { runs: number; low: number; high: number; p90: number };
      }
    ).usual;

  it("reads the last succeeded runs of the same prompt text and model, and gives their quartiles and 90th percentile", async ({
    expect,
  }) => {
    // 8 runs of 60 to 130 s, the newest first.
    for (const [index, seconds] of [
      60, 70, 80, 90, 100, 110, 120, 130,
    ].entries()) {
      await job({ status: "succeeded", seconds, hash: "a", ago: 100 + index });
    }
    // Left out: a timed out run, another text, another model, another prompt.
    await job({ status: "timed_out", seconds: 900, hash: "a" });
    await job({ status: "succeeded", seconds: 900, hash: "b" });
    await job({ status: "succeeded", seconds: 900, hash: "a", model: "opus" });
    await job({
      status: "succeeded",
      seconds: 900,
      hash: "a",
      prompt: "feedback",
    });
    const running = await job({ status: "running", hash: "a", ago: 1 });

    expect(await usualOf(running.id)).toEqual({
      runs: 8,
      low: 70,
      high: 110,
      p90: 130,
    });
  });

  it("keeps the 20 newest", async ({ expect }) => {
    for (let index = 0; index < 25; index += 1) {
      // The 5 that ended first are long.
      await job({
        status: "succeeded",
        seconds: index >= 20 ? 3600 : 60,
        hash: "a",
        // Ended well before the 20 short ones.
        ago: index >= 20 ? 300 + index : 100 + index,
      });
    }
    const running = await job({ status: "running", hash: "a", ago: 1 });
    expect(await usualOf(running.id)).toMatchObject({ runs: 20, p90: 60 });
  });

  it("gives nothing under 5 runs, nor for a job with no hash, nor once the job ended", async ({
    expect,
  }) => {
    for (let index = 0; index < 4; index += 1) {
      await job({ status: "succeeded", hash: "a", ago: 100 + index });
    }
    const running = await job({ status: "running", hash: "a", ago: 1 });
    expect(await usualOf(running.id)).toBeUndefined();
    await job({ status: "succeeded", hash: "a", ago: 200 });
    expect(await usualOf(running.id)).toBeDefined();
    const unhashed = await job({ status: "running", ago: 1 });
    expect(await usualOf(unhashed.id)).toBeUndefined();
    const ended = await job({ status: "succeeded", hash: "a", ago: 2 });
    expect(await usualOf(ended.id)).toBeUndefined();
  });
});
