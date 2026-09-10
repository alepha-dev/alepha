import { Alepha, AlephaError, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { queueWorkerOptions } from "alepha/queue";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AppController } from "../src/api/controllers/AppController.ts";
import { ProjectCapabilityController } from "../src/api/controllers/ProjectCapabilityController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { appInstances } from "../src/api/entities/appInstances.ts";
import { artifacts } from "../src/api/entities/artifacts.ts";
import { deployments } from "../src/api/entities/deployments.ts";
import { estateProjects } from "../src/api/entities/estateProjects.ts";
import { estates } from "../src/api/entities/estates.ts";
import { LoreApi } from "../src/api/index.ts";
import { DeployJobs } from "../src/api/jobs/DeployJobs.ts";
import { CredentialSealService } from "../src/api/services/CredentialSealService.ts";
import { DeployLimits } from "../src/api/services/DeployLimits.ts";
import {
  type DeployRequest,
  DeployRunner,
} from "../src/api/services/DeployRunner.ts";

/**
 * What happens to a deploy that lands while the isolate is already running
 * its cap.
 *
 * ⚠️ **It used to be lost.** `DeployService.run` threw when no slot was free,
 * `lore.deploy.run` has no retry, so the execution went terminal on the throw
 * and the row sat `queued` until the sweep failed it fifteen minutes later with
 * a message claiming it had stopped reporting - about a deploy that never
 * started. Only reachable once `4b91bed72` gave each queued job its own
 * invocation, which is what these five workers stand in for.
 *
 * Everything up to the Cloudflare call is the real code: the job, the slot,
 * the gate, the sealed credential, the secrets. Only the runner is
 * substituted, with one that records a start and then waits to be let go.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({ username: z.string(), email: z.email() });

/**
 * Poll `fn` until `predicate` holds, or throw on timeout. Fixed sleeps race
 * the worker loop under load; polling does not.
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
 * A runner that writes the start the real one writes, then holds until the
 * spec releases it.
 */
class HeldDeployRunner extends DeployRunner {
  /**
   * Every deployment id this runner was handed, in order.
   */
  public readonly calls: string[] = [];
  public running = 0;
  public peak = 0;
  /**
   * When off, a run finishes as soon as it has started.
   */
  public hold = true;
  /**
   * When set, a run fails with this message, the way the real one does.
   */
  public failWith?: string;
  protected readonly waiting = new Map<string, () => void>();

  public override async run(
    request: DeployRequest,
  ): Promise<{ urls: string[] }> {
    const id = request.deploymentId as string;
    this.calls.push(id);
    this.running++;
    this.peak = Math.max(this.peak, this.running);
    try {
      await this.registry.started(id);
      if (this.hold) {
        await new Promise<void>((resolve) => this.waiting.set(id, resolve));
      }
      if (this.failWith) {
        await this.registry.failed(id, this.failWith);
        throw new AlephaError(this.failWith);
      }
      await this.registry.succeeded(id, { url: "https://example.test" });
      return { urls: ["https://example.test"] };
    } finally {
      this.running--;
    }
  }

  /**
   * The runs currently held.
   */
  public held(): number {
    return this.waiting.size;
  }

  /**
   * Let every held run finish.
   */
  public release(): void {
    for (const [id, resolve] of this.waiting) {
      this.waiting.delete(id);
      resolve();
    }
  }
}

class TestRows {
  public readonly deployments = $repository(deployments);
  public readonly estates = $repository(estates);
  public readonly grants = $repository(estateProjects);
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
      // A run seals `APP_SECRET` for a copy that has none, and
      // `CredentialSealService` refuses the published default.
      APP_SECRET: "a-strong-and-unique-app-secret-for-tests",
    },
  });
  // ⚠️ Before the module that resolves it, or the substitution is too late.
  alepha.with({ provide: DeployRunner, use: HeldDeployRunner });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with(TestRows);
  // Five workers, the way Cloudflare gives each queued message its own
  // invocation. With the default single worker no two deploys ever overlap,
  // which is exactly the world in which this was never noticed.
  alepha.store.mut(queueWorkerOptions, () => ({
    concurrency: 5,
    interval: 10,
    maxInterval: 50,
  }));
  await alepha.start();
  return alepha;
};

describe("a deploy that finds no free slot", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    // A held run would keep a worker busy, and stop() waits for workers.
    const runner = alepha.inject(DeployRunner) as HeldDeployRunner;
    runner.hold = false;
    runner.release();
    await alepha.stop();
  });

  const runner = () => alepha.inject(DeployRunner) as HeldDeployRunner;
  const rows = () => alepha.inject(TestRows);

  /**
   * A copy on a Cloudflare estate that passes the gate, with one stored
   * `workerd` archive to ship.
   */
  const world = async () => {
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
          { body: { title: `Slots ${crypto.randomUUID().slice(0, 8)}` } },
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
          body: { app: "my-app", env: "b14-preview" },
        },
        { user },
      )
    ).data;

    const estate = await rows().estates.create({
      ownerUserId: user.id,
      type: "cloudflare",
      slug: `cf-${crypto.randomUUID().slice(0, 6)}`,
      deployAllowed: true,
      credentialStatus: "valid",
      accountId: "acct",
      credential: alepha
        .inject(CredentialSealService)
        .seal("token", CredentialSealService.ESTATE_PURPOSE),
    } as never);
    await rows().grants.create({
      estateId: estate.id,
      projectId: project.id,
    } as never);
    await rows().instances.updateById(instance.id, { estateId: estate.id });

    const sha256 = "a".repeat(64);
    await rows().artifacts.create({
      projectId: project.id,
      app: "my-app",
      tag: "latest",
      runtime: "workerd",
      format: "archive",
      sha256,
      fileId: crypto.randomUUID(),
    } as never);

    return { project, instance, sha256 };
  };

  /**
   * A queued row, as `DeployService.queue` writes it.
   */
  const aDeployment = async (
    w: Awaited<ReturnType<typeof world>>,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const row = await rows().deployments.create({
      projectId: w.project.id,
      instanceId: w.instance.id,
      app: "my-app",
      tag: "latest",
      sha256: w.sha256,
      status: "queued",
      ...extra,
    } as never);
    return row.id;
  };

  /**
   * What the Deploy button does once the row exists.
   */
  const push = async (deploymentId: string) =>
    await alepha
      .inject(DeployJobs)
      .runDeploy.push(
        { deploymentId, stage: "deploy" },
        { key: DeployJobs.key(deploymentId) },
      );

  const statusOf = async (deploymentId: string) =>
    (await rows().deployments.findById(deploymentId))?.status;

  /**
   * The execution carrying this deployment. Found by payload, not by key:
   * the key is cleared once an execution is terminal, so it can be reused.
   */
  const executionOf = async (deploymentId: string) =>
    (
      await rows().executions.findMany({
        where: { jobName: { eq: "lore.deploy.run" } },
      })
    ).find((it) => it.payload?.deploymentId === deploymentId);

  /**
   * Hold two runs, which is the default cap.
   */
  const holdTwo = async (w: Awaited<ReturnType<typeof world>>) => {
    const first = await aDeployment(w);
    const second = await aDeployment(w);
    await push(first);
    await push(second);
    await waitFor(
      () => runner().held(),
      (n) => n === 2,
      { label: "two runs held" },
    );
    return [first, second];
  };

  it("waits for a slot and runs once one frees, with no sweep involved", async ({
    expect,
  }) => {
    const w = await world();
    const held = await holdTwo(w);

    const third = await aDeployment(w);
    await push(third);

    // Parked, not refused: the execution waits for its next try and the row
    // still reads `queued`, which is what the Deploy tab shows.
    await waitFor(
      () => executionOf(third),
      (e) => e?.status === "scheduled",
      { label: "third execution parked" },
    );
    expect(await statusOf(third)).toBe("queued");
    expect(runner().calls).not.toContain(third);

    runner().hold = false;
    runner().release();
    for (const id of held) {
      await waitFor(
        () => statusOf(id),
        (s) => s === "succeeded",
        { label: `held run ${id} succeeded` },
      );
    }

    await alepha
      .inject(DateTimeProvider)
      .travel([DeployJobs.SLOT_RETRY_SECONDS + 1, "seconds"]);

    const after = await waitFor(
      () => rows().deployments.findById(third),
      (r) => r?.status === "succeeded",
      { label: "third run succeeded" },
    );
    // queued, then running, then terminal: the runner wrote a start, and
    // nothing wrote a failure on the way.
    expect(after?.startedAt).toBeDefined();
    expect(after?.error).toBeUndefined();
    expect(runner().peak).toBe(2);
  });

  it("runs a burst of five with never more than two at a time", async ({
    expect,
  }) => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await aDeployment(w));
    }
    for (const id of ids) {
      await push(id);
    }

    // One round per slot pair: two held, the rest parked, release, travel.
    // Bounded, so a regression that parks forever fails here rather than
    // hanging the suite.
    for (let round = 0; round < 5; round++) {
      const statuses = await Promise.all(ids.map(statusOf));
      const open = ids.filter((_, i) => statuses[i] !== "succeeded");
      if (open.length === 0) {
        break;
      }
      await waitFor(
        async () => {
          const executions = await Promise.all(open.map(executionOf));
          const parked = executions.filter(
            (e) => e?.status === "scheduled",
          ).length;
          return { held: runner().held(), parked };
        },
        ({ held, parked }) =>
          held === Math.min(2, open.length) && held + parked === open.length,
        { label: `round ${round}: runs held and the rest parked` },
      );
      runner().release();
      await waitFor(
        async () =>
          (await Promise.all(ids.map(statusOf))).filter(
            (s) => s === "succeeded",
          ).length,
        (n) => n === ids.length - open.length + Math.min(2, open.length),
        { label: `round ${round}: released runs succeeded` },
      );
      await alepha
        .inject(DateTimeProvider)
        .travel([DeployJobs.SLOT_RETRY_SECONDS + 1, "seconds"]);
    }

    expect(await Promise.all(ids.map(statusOf))).toEqual(
      ids.map(() => "succeeded"),
    );
    expect(runner().peak).toBe(2);
    // Each deploy reached the runner exactly once: waiting is not a retry.
    expect([...runner().calls].sort()).toEqual([...ids].sort());
  });

  it("fails, saying so, once it has waited longer than a deploy may take", async ({
    expect,
  }) => {
    const w = await world();
    await holdTwo(w);

    // Queued longer ago than the deploy timeout, so this is its last look.
    const budgetMs = await alepha.inject(DeployLimits).timeoutMs();
    const createdAt = new Date(
      alepha.inject(DateTimeProvider).nowMillis() - budgetMs - 60_000,
    ).toISOString();
    const late = await aDeployment(w, { createdAt });
    await push(late);

    const after = await waitFor(
      () => rows().deployments.findById(late),
      (r) => r?.status === "failed",
      { label: "late run failed" },
    );
    expect(after?.error).toMatch(/free slot/);
    expect(after?.error).toMatch(/Nothing reached Cloudflare/);
    expect(runner().calls).not.toContain(late);
    // Terminal rather than parked again.
    expect((await executionOf(late))?.status).not.toBe("scheduled");
  });

  it("still fails a real deploy failure exactly once, with no second run", async ({
    expect,
  }) => {
    const w = await world();
    runner().hold = false;
    runner().failWith = "Cloudflare refused the upload";

    const id = await aDeployment(w);
    await push(id);

    const after = await waitFor(
      () => rows().deployments.findById(id),
      (r) => r?.status === "failed",
      { label: "failed run" },
    );
    expect(after?.error).toMatch(/refused the upload/);
    await waitFor(
      () => executionOf(id),
      (e) => e?.status === "error",
      { label: "execution failed" },
    );

    // Past any retry or slot wait: a failure is not a reason to run again.
    await alepha
      .inject(DateTimeProvider)
      .travel([DeployJobs.SLOT_RETRY_SECONDS + 1, "seconds"]);
    expect(runner().calls.filter((it) => it === id)).toHaveLength(1);
  });

  it("does not run a replayed execution of a finished deploy", async ({
    expect,
  }) => {
    const w = await world();
    const id = await aDeployment(w, { status: "succeeded" });

    const executionId = await push(id);

    // A successful execution is deleted rather than kept, so gone is done.
    await waitFor(
      () => rows().executions.findById(executionId),
      (e) => e === undefined || e.status === "ok",
      { label: "replay finished" },
    );
    expect(runner().calls).not.toContain(id);
    expect(await statusOf(id)).toBe("succeeded");
  });
});
