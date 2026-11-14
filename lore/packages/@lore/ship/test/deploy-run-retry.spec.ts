import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { Alepha, AlephaError, type Infer, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm, DbTimeoutError } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  AppController,
  CredentialSealService,
  DeployJobs,
  DeployLimits,
  type DeployRequest,
  DeployRunner,
  LoreShipApi,
} from "../src/api/index.ts";
import {
  appInstances,
  artifacts,
  deployments,
  hostProjects,
  hosts,
} from "../src/schemas/index.ts";

/**
 * A deploy whose first read times out on D1 (#Q3551).
 *
 * On 2026-11-12 a production deploy's `deploys.run` failed on its very first
 * query, `findById` of its own row, with a D1 timeout. The job had no retry,
 * so the execution died there; the row stayed `queued` with an empty log, and
 * 15 minutes later the sweep failed it as "no run picked it up", which was
 * false. These pin the three answers: the run retries a database that did not
 * answer, a run that fails for good says so on its row at once, and the sweep
 * names an errored run rather than a missing one.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({ username: z.string(), email: z.email() });

/**
 * Poll `fn` until `predicate` holds, or throw on timeout.
 */
const waitFor = async <T>(
  fn: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  { timeout = 5000, interval = 10, label = "condition" } = {},
): Promise<T> => {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new AlephaError(
    `waitFor: ${label} not met within ${timeout}ms; last value: ${JSON.stringify(last)}`,
  );
};

/**
 * The run's first read fails the way D1's did, `failures` times.
 */
class FlakyDeployJobs extends DeployJobs {
  public failures = 0;
  public reads = 0;

  protected override async load(
    deploymentId: string,
  ): Promise<Infer<typeof deployments.schema> | undefined> {
    this.reads++;
    if (this.failures > 0) {
      this.failures--;
      throw new DbTimeoutError(
        `D1 query timed out: select ... from "deployments" where "deployments"."id" = ? limit ?`,
      );
    }
    return await super.load(deploymentId);
  }
}

/**
 * A runner that writes what the real one writes and ships nothing.
 */
class InstantDeployRunner extends DeployRunner {
  public readonly calls: string[] = [];

  public override async run(
    request: DeployRequest,
  ): Promise<{ urls: string[] }> {
    const id = request.deploymentId as string;
    this.calls.push(id);
    await this.registry.started(id);
    await this.registry.succeeded(id, { url: "https://example.test" });
    return { urls: ["https://example.test"] };
  }
}

class TestRows {
  public readonly deployments = $repository(deployments);
  public readonly hosts = $repository(hosts);
  public readonly grants = $repository(hostProjects);
  public readonly instances = $repository(appInstances);
  public readonly artifacts = $repository(artifacts);
  public readonly executions = $repository(jobExecutionEntity);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-and-unique-app-secret-for-tests",
    },
  });
  // ⚠️ Before the module that resolves them, or the substitution is too late.
  alepha.with({ provide: DeployRunner, use: InstantDeployRunner });
  alepha.with({ provide: DeployJobs, use: FlakyDeployJobs });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreShipApi);
  alepha.with(TestRows);
  await alepha.start();
  return alepha;
};

describe("a deploy whose first read times out", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const jobs = () => alepha.inject(DeployJobs) as FlakyDeployJobs;
  const runner = () => alepha.inject(DeployRunner) as InstantDeployRunner;
  const rows = () => alepha.inject(TestRows);
  const travel = async (seconds: number) =>
    await alepha.inject(DateTimeProvider).travel([seconds, "seconds"]);

  /**
   * A copy on a Cloudflare host that passes the gate, with one stored
   * `workerd` archive to ship, and a queued deployment of it.
   */
  const aQueuedDeployment = async (): Promise<string> => {
    const fake = alepha.inject(FakeProvider).generate(userDataSchema);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    const user = { id: created.data.id, roles: created.data.roles };
    const project = (
      await alepha
        .inject(ProjectController)
        .createProject.fetch(
          { body: { title: `Retry ${crypto.randomUUID().slice(0, 8)}` } },
          { user },
        )
    ).data;
    await alepha.inject(ProjectCapabilityController).setCapability.fetch(
      {
        params: { projectId: project.id, key: "apps" },
        body: { enabled: true },
      },
      { user },
    );
    const instance = (
      await alepha.inject(AppController).createApp.fetch(
        {
          params: { projectId: project.id },
          body: { app: "my-app", env: "production" },
        },
        { user },
      )
    ).data;
    const host = await rows().hosts.create({
      ownerUserId: user.id,
      type: "cloudflare",
      slug: `cf-${crypto.randomUUID().slice(0, 6)}`,
      deployAllowed: true,
      credentialStatus: "valid",
      accountId: "acct",
      credential: await alepha
        .inject(CredentialSealService)
        .seal("token", CredentialSealService.HOST_PURPOSE),
    } as never);
    await rows().grants.create({ hostId: host.id, projectId: project.id });
    await rows().instances.updateById(instance.id, { hostId: host.id });
    const sha256 = "b".repeat(64);
    await rows().artifacts.create({
      projectId: project.id,
      app: "my-app",
      tag: "latest",
      runtime: "workerd",
      format: "archive",
      sha256,
      fileId: crypto.randomUUID(),
    });
    const row = await rows().deployments.create({
      projectId: project.id,
      instanceId: instance.id,
      app: "my-app",
      tag: "latest",
      sha256,
      status: "queued",
    });
    return row.id;
  };

  const push = async (deploymentId: string) =>
    await alepha
      .inject(DeployJobs)
      .runDeploy.push(
        { deploymentId, stage: "deploy" },
        { key: DeployJobs.key(deploymentId) },
      );

  const executionOf = async (deploymentId: string) =>
    (
      await rows().executions.findMany({
        where: { jobName: { eq: "deploys.run" } },
      })
    ).find((it) => it.payload?.deploymentId === deploymentId);

  it("retries a timed-out first read and deploys", async ({ expect }) => {
    const id = await aQueuedDeployment();
    jobs().failures = 2;

    await push(id);

    // Each retry waits its backoff, at most 15 s: travel until it lands.
    const row = await waitFor(
      async () => {
        await travel(16);
        return await rows().deployments.findById(id);
      },
      (r) => r?.status === "succeeded",
      { label: "deploy succeeded after two timeouts" },
    );

    expect(row?.error).toBeUndefined();
    expect(jobs().reads).toBe(3);
    expect(runner().calls).toEqual([id]);
    expect((await executionOf(id))?.status).toBe("ok");
  });

  it("writes the reason to the row at once when the database never answers", async ({
    expect,
  }) => {
    const id = await aQueuedDeployment();
    jobs().failures = Number.POSITIVE_INFINITY;

    await push(id);

    const row = await waitFor(
      async () => {
        await travel(16);
        return await rows().deployments.findById(id);
      },
      (r) => r?.status === "failed",
      { label: "deploy failed with its reason" },
    );

    // Tried once, then retried RUN_RETRIES times, and never deployed.
    expect(jobs().reads).toBe(DeployJobs.RUN_RETRIES + 1);
    expect(runner().calls).toEqual([]);
    expect(row?.error).toContain("The database did not answer");
    expect(row?.error).toContain("D1 query timed out");
    expect(row?.error).toContain("Nothing reached Cloudflare");
    // Long before the sweep's budget: the operator learns in seconds.
    const budgetMs =
      (await alepha.inject(DeployLimits).timeoutMs()) +
      DeployJobs.SWEEP_GRACE_MS;
    expect(
      new Date(row!.finishedAt!).getTime() - new Date(row!.createdAt).getTime(),
    ).toBeLessThan(budgetMs);
    const execution = await executionOf(id);
    expect(execution?.status).toBe("error");
    expect(execution?.attempt).toBe(DeployJobs.RUN_RETRIES + 1);
  });

  it("fails a non-transient error for good on the first try", async ({
    expect,
  }) => {
    const id = await aQueuedDeployment();
    await rows().artifacts.deleteMany({ sha256: { eq: "b".repeat(64) } });

    await push(id);

    const row = await waitFor(
      () => rows().deployments.findById(id),
      (r) => r?.status === "failed",
      { label: "deploy failed on its missing artifact" },
    );

    expect(jobs().reads).toBe(1);
    expect(row?.error).toContain("no longer stored");
  });

  it("has the sweep name an errored run instead of a missing one", async ({
    expect,
  }) => {
    const id = await aQueuedDeployment();
    // The run failed and could not write its own failure: the row stayed
    // `queued`, and only the execution knows why.
    await rows().executions.create({
      jobName: "deploys.run",
      status: "error",
      attempt: DeployJobs.RUN_RETRIES + 1,
      maxAttempts: DeployJobs.RUN_RETRIES + 1,
      payload: { deploymentId: id, stage: "deploy" },
      error: "D1 query timed out: select ... from deployments",
    });

    const budgetMs =
      (await alepha.inject(DeployLimits).timeoutMs()) +
      DeployJobs.SWEEP_GRACE_MS;
    await travel(Math.ceil(budgetMs / 1000) + 5 * 60);

    const row = await waitFor(
      () => rows().deployments.findById(id),
      (r) => r?.status === "failed",
      { label: "sweep failed the row" },
    );
    expect(row?.error).toContain("failed before it started");
    expect(row?.error).toContain("D1 query timed out");
    expect(row?.error).not.toContain("no run picked it up");
  });
});
