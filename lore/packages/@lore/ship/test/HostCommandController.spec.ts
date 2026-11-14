import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ForbiddenError, NotFoundError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreShipApi } from "../src/api/index.ts";
import { HostCommandController, HostController } from "../src/api/index.ts";
import { HostCommandService } from "../src/api/services/HostCommandService.ts";
import {
  appInstances,
  artifacts,
  hostProjects,
  type Host,
  hosts,
} from "../src/schemas/index.ts";
import { createTestHost } from "../src/testing/hosts.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repos {
  hosts = $repository(hosts);
  artifacts = $repository(artifacts);
  grants = $repository(hostProjects);
  instances = $repository(appInstances);
  projects = $repository(projects);
}

interface TestContext {
  alepha: Alepha;
  commands: HostCommandController;
  hostApi: HostController;
  repos: Repos;
  entities: DeployTestEntities;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repos);
  await alepha.start();

  return {
    alepha,
    commands: alepha.inject(HostCommandController),
    hostApi: alepha.inject(HostController),
    repos,
    entities,
  };
};

const createUser = async (ctx: TestContext): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({});
  return { id: user.id, roles: ["user"] };
};

const createHost = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
  deployAllowed: boolean,
): Promise<Host> => {
  const minted = await createTestHost(ctx.alepha, user, { slug });
  await ctx.repos.hosts.updateById(minted.id, { deployAllowed });
  return ctx.repos.hosts.getOne({ where: { id: { eq: minted.id } } });
};

const storeArtifact = (ctx: TestContext, projectId: number) =>
  ctx.repos.artifacts.create({
    projectId,
    app: "demo",
    tag: "1.0.0",
    runtime: "node",
    sha256: "a".repeat(64),
    size: 42,
    fileId: crypto.randomUUID(),
  });

/**
 * An owner with a project, a host lent to it, an artifact in it, and the
 * `demo/production` copy pointed at that host: the whole of what a deploy
 * names.
 */
const lentSetup = async (
  ctx: TestContext,
  deployAllowed: boolean,
  host?: Host,
) => {
  const owner = host
    ? { id: host.ownerUserId, roles: ["user"] }
    : await createUser(ctx);
  const project = await createTestProject(ctx.alepha, { createdBy: owner.id });
  const target = host ?? (await createHost(ctx, owner, "ovh-1", deployAllowed));
  await ctx.repos.grants.create({
    hostId: target.id,
    projectId: project.id,
    createdBy: owner.id,
  });
  const artifact = await storeArtifact(ctx, project.id);
  const instance = await ctx.repos.instances.create({
    projectId: project.id,
    app: "demo",
    env: "production",
    hostId: target.id,
  });
  return { owner, project, host: target, artifact, instance };
};

const deployOf = (
  ctx: TestContext,
  setup: Awaited<ReturnType<typeof lentSetup>>,
) =>
  ctx.commands.enqueueHostCommand(
    {
      params: { hostId: setup.host.id },
      body: {
        kind: "deploy",
        artifactId: setup.artifact.id,
        environment: "production",
      },
    },
    { user: setup.owner },
  );

describe("HostCommandController, enqueuing by hand", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("queues a restart for an instance on the caller's host", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const host = await createHost(ctx, owner, "ovh-1", false);

    const queued = await ctx.commands.enqueueHostCommand(
      {
        params: { hostId: host.id },
        body: { kind: "restart", app: "demo", environment: "production" },
      },
      { user: owner },
    );
    expect(queued).toMatchObject({
      kind: "restart",
      status: "pending",
      payload: { app: "demo", environment: "production" },
      requestedBy: owner.id,
    });
  });

  it("queues a deploy naming the artifact by digest, the app from the artifact row", async ({
    expect,
  }) => {
    const { owner, project, host, artifact } = await lentSetup(ctx, true);

    const queued = await ctx.commands.enqueueHostCommand(
      {
        params: { hostId: host.id },
        body: {
          kind: "deploy",
          artifactId: artifact.id,
          environment: "production",
        },
      },
      { user: owner },
    );
    expect(queued).toMatchObject({
      kind: "deploy",
      status: "pending",
      payload: {
        app: "demo",
        environment: "production",
        project: project.slug,
        artifact: { id: artifact.id, sha256: "a".repeat(64), size: 42 },
      },
    });
  });

  it("refuses a deploy while the host's switch is off, server-side", async ({
    expect,
  }) => {
    const { owner, host, artifact } = await lentSetup(ctx, false);
    await expect(
      ctx.commands.enqueueHostCommand(
        {
          params: { hostId: host.id },
          body: {
            kind: "deploy",
            artifactId: artifact.id,
            environment: "production",
          },
        },
        { user: owner },
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(
      await ctx.repos.hosts.getOne({ where: { id: { eq: host.id } } }),
    ).toBeDefined();
  });

  it("stores no name for a deploy the host refuses", async ({ expect }) => {
    // The name is stored before the command is queued, so the host's own
    // gates have to be asked first: a refused deploy must not fix a name.
    const setup = await lentSetup(ctx, false);

    await expect(deployOf(ctx, setup)).rejects.toThrow(ForbiddenError);

    const after = await ctx.repos.instances.findById(setup.instance.id);
    expect(after?.resourceName).toBeUndefined();
  });

  it("refuses a deploy when the host is not lent to the artifact's project", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const project = await createTestProject(ctx.alepha, {
      createdBy: owner.id,
    });
    const host = await createHost(ctx, owner, "ovh-1", true);
    const artifact = await storeArtifact(ctx, project.id);

    await expect(
      ctx.commands.enqueueHostCommand(
        {
          params: { hostId: host.id },
          body: {
            kind: "deploy",
            artifactId: artifact.id,
            environment: "production",
          },
        },
        { user: owner },
      ),
    ).rejects.toThrow(/not lent/);
  });

  it("refuses a deploy of an artifact from a project the caller is not in", async ({
    expect,
  }) => {
    const { host, artifact } = await lentSetup(ctx, true);
    // Another user who owns their own host lent to nothing: the artifact
    // belongs to a project they cannot read.
    const stranger = await createUser(ctx);
    const theirs = await createHost(ctx, stranger, "hetzner", true);

    await expect(
      ctx.commands.enqueueHostCommand(
        {
          params: { hostId: theirs.id },
          body: {
            kind: "deploy",
            artifactId: artifact.id,
            environment: "production",
          },
        },
        { user: stranger },
      ),
    ).rejects.toThrow(ForbiddenError);
    // And a host of a project they are not in is not theirs to command.
    await expect(
      ctx.commands.enqueueHostCommand(
        {
          params: { hostId: host.id },
          body: { kind: "restart", app: "demo", environment: "production" },
        },
        { user: stranger },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("answers 404 for an artifact that does not exist", async ({ expect }) => {
    const { owner, host } = await lentSetup(ctx, true);
    await expect(
      ctx.commands.enqueueHostCommand(
        {
          params: { hostId: host.id },
          body: {
            kind: "deploy",
            artifactId: crypto.randomUUID(),
            environment: "production",
          },
        },
        { user: owner },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

/**
 * The name a Bay copy is deployed under.
 *
 * ⚠️ Bay composes its instance key, its directory under `apps/` and its
 * default subdomain from `<project>-<app>` and the environment. Sending the
 * project's CURRENT slug meant a rename started a new, empty instance beside
 * the live one. The segment now comes from the copy's stored name (#Q2475).
 */
describe("HostCommandController, the name a Bay deploy sends", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("stores <project>-<app>-<env> on the copy's first deploy", async ({
    expect,
  }) => {
    const setup = await lentSetup(ctx, true);

    await deployOf(ctx, setup);

    const after = await ctx.repos.instances.findById(setup.instance.id);
    expect(after?.resourceName).toBe(`${setup.project.slug}-demo-production`);
  });

  it("vouches for the copy on its host once the deploy is done, never when queued", async ({
    expect,
  }) => {
    const setup = await lentSetup(ctx, true);
    const command = await deployOf(ctx, setup);

    // Queued, refused or failed, the deploy replaced nothing on the machine:
    // whatever runs under that name there is not yet this copy.
    const queued = await ctx.repos.instances.findById(setup.instance.id);
    expect(queued?.resourceHostId).toBeUndefined();

    const service = ctx.alepha.inject(HostCommandService);
    await service.ack(setup.host.id, { id: command.id, status: "running" });
    await service.ack(setup.host.id, { id: command.id, status: "done" });

    const done = await ctx.repos.instances.findById(setup.instance.id);
    expect(done?.resourceHostId).toBe(setup.host.id);
  });

  it("sends the stored project segment after the project is renamed", async ({
    expect,
  }) => {
    const setup = await lentSetup(ctx, true);
    await deployOf(ctx, setup);
    const original = setup.project.slug;

    await ctx.repos.projects.updateById(setup.project.id, {
      slug: "renamed-project",
    });
    const queued = await deployOf(ctx, setup);

    expect(queued.payload).toMatchObject({ project: original });
  });

  it("refuses a deploy for a copy the project does not have", async ({
    expect,
  }) => {
    const setup = await lentSetup(ctx, true);
    await ctx.repos.instances.deleteById(setup.instance.id);

    await expect(deployOf(ctx, setup)).rejects.toThrow(
      /has no copy named demo\/production/,
    );
  });

  it("refuses a deploy for a copy pointed at another host", async ({
    expect,
  }) => {
    const setup = await lentSetup(ctx, true);
    const other = await createHost(ctx, setup.owner, "ovh-2", true);
    await ctx.repos.instances.updateById(setup.instance.id, {
      hostId: other.id,
    });

    await expect(deployOf(ctx, setup)).rejects.toThrow(
      /deploys to another host/,
    );
  });

  it("refuses a copy whose env was renamed since its first deploy", async ({
    expect,
  }) => {
    // The command carries the env as it is NOW, and Bay would compose a new
    // key from it: a new, empty instance beside the one the name belongs to.
    const setup = await lentSetup(ctx, true);
    await ctx.repos.instances.updateById(setup.instance.id, {
      resourceName: `${setup.project.slug}-demo-staging`,
    });

    await expect(deployOf(ctx, setup)).rejects.toThrow(
      /was first deployed to this machine as/,
    );
  });

  it("refuses a name another copy on the same machine already holds", async ({
    expect,
  }) => {
    // A rename frees a slug. A project that takes it derives the very same
    // name, and its deploy would replace the first project's instance.
    const first = await lentSetup(ctx, true);
    await deployOf(ctx, first);
    const second = await lentSetup(ctx, true, first.host);
    await ctx.repos.projects.updateById(first.project.id, {
      slug: "moved-on",
    });
    await ctx.repos.projects.updateById(second.project.id, {
      slug: first.project.slug,
    });

    await expect(deployOf(ctx, second)).rejects.toThrow(
      /Another copy on this Bay machine is already named/,
    );
    const after = await ctx.repos.instances.findById(second.instance.id);
    expect(after?.resourceName).toBeUndefined();
  });

  it("sends no project for a copy first deployed without one", async ({
    expect,
  }) => {
    // A project with no slug always sent no segment, so Bay composed
    // `<app>`: its live instance must not move now.
    const setup = await lentSetup(ctx, true);
    await ctx.repos.instances.updateById(setup.instance.id, {
      resourceName: "demo-production",
    });

    const queued = await deployOf(ctx, setup);

    expect(queued.payload).not.toHaveProperty("project");
  });
});

/**
 * The one verb that refuses instead of queueing.
 *
 * A log tail delivered three hours later, after nobody is looking, is worse
 * than an error: it is a read, and a stale read is worthless. This is where
 * the epic deliberately breaks the queue-and-redeliver pattern #E20 built,
 * and the refusal happens before any row exists.
 */
describe("HostCommandController, logs", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const online = async (ctx: TestContext, host: Host) => {
    const now = new Date().toISOString();
    await ctx.repos.hosts.updateById(host.id, {
      connectedAt: now,
      lastSeenAt: now,
    });
  };

  it("refuses while the machine is offline, and queues nothing", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const host = await createHost(ctx, owner, "ovh-logs-off", false);

    await expect(
      ctx.commands.enqueueHostCommand(
        {
          params: { hostId: host.id },
          body: { kind: "logs", app: "demo", environment: "production" },
        },
        { user: owner },
      ),
    ).rejects.toThrow(/not connected/);

    const listed = await ctx.commands.listHostCommands(
      { params: { hostId: host.id } },
      { user: owner },
    );
    expect(listed.items).toEqual([]);
  });

  it("refuses a restore or a policy change while the machine is offline", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const host = await createHost(ctx, owner, "ovh-restore-off", true);
    const send = (body: object) =>
      ctx.commands.enqueueHostCommand(
        { params: { hostId: host.id }, body: body as never },
        { user: owner },
      );
    const target = { app: "demo", environment: "production" };

    await expect(
      send({ ...target, kind: "restore", reason: "wrong import" }),
    ).rejects.toThrow(/not connected/);
    await expect(
      send({ ...target, kind: "backup-policy", policy: null }),
    ).rejects.toThrow(/not connected/);

    await online(ctx, host);
    const command = await send({
      ...target,
      kind: "restore",
      reason: "wrong import",
    });
    expect(command.kind).toBe("restore");
  });

  it("queues a bounded ask while the machine is connected, defaulting the line count", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const host = await createHost(ctx, owner, "ovh-logs-on", false);
    await online(ctx, host);

    const command = await ctx.commands.enqueueHostCommand(
      {
        params: { hostId: host.id },
        body: {
          kind: "logs",
          app: "demo",
          environment: "production",
          grep: "ERROR",
        },
      },
      { user: owner },
    );

    expect(command.kind).toBe("logs");
    expect(command.payload.logs).toEqual({ lines: 200, grep: "ERROR" });
    // The frame is what the machine reads: without it Bay has no line count.
    const frame = ctx.alepha.inject(HostCommandService).frameOf(command);
    expect(frame.logs).toEqual({ lines: 200, grep: "ERROR" });
  });

  /**
   * A row whose blob the 24 h sweep has taken is the NORMAL end state, and it
   * reads as "expired" rather than a 500 about a missing file. A row that
   * never had one reads as "no result".
   */
  it("answers the owner a 404 for a command with no stored result", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const host = await createHost(ctx, owner, "ovh-logs-result", false);
    await online(ctx, host);
    const command = await ctx.commands.enqueueHostCommand(
      {
        params: { hostId: host.id },
        body: { kind: "logs", app: "demo", environment: "production" },
      },
      { user: owner },
    );

    await expect(
      ctx.commands.getHostCommandResult(
        { params: { hostId: host.id, commandId: command.id } },
        { user: owner },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses a log tail to a non-member of the home project", async ({
    expect,
  }) => {
    const ada = await createUser(ctx);
    const grace = await createUser(ctx);
    const host = await createHost(ctx, ada, "ovh-logs-mine", false);
    await online(ctx, host);
    const command = await ctx.commands.enqueueHostCommand(
      {
        params: { hostId: host.id },
        body: { kind: "logs", app: "demo", environment: "production" },
      },
      { user: ada },
    );

    await expect(
      ctx.commands.getHostCommandResult(
        { params: { hostId: host.id, commandId: command.id } },
        { user: grace },
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});
