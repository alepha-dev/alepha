import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ForbiddenError, NotFoundError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { artifacts } from "../entities/artifacts.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import { EstateCommandController } from "./EstateCommandController.ts";
import { EstateController } from "./EstateController.ts";

class Repos {
  estates = $repository(estates);
  artifacts = $repository(artifacts);
  grants = $repository(estateProjects);
}

interface TestContext {
  alepha: Alepha;
  commands: EstateCommandController;
  estateApi: EstateController;
  repos: Repos;
  entities: TestEntityRepositories;
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
  alepha.with(LoreApi);

  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(Repos);
  await alepha.start();

  return {
    alepha,
    commands: alepha.inject(EstateCommandController),
    estateApi: alepha.inject(EstateController),
    repos,
    entities,
  };
};

const createUser = async (ctx: TestContext): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({});
  return { id: user.id, roles: ["user"] };
};

const createEstate = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
  deployAllowed: boolean,
): Promise<Estate> => {
  const minted = await ctx.estateApi.createEstate({ body: { slug } }, { user });
  await ctx.repos.estates.updateById(minted.id, { deployAllowed });
  return ctx.repos.estates.getOne({ where: { id: { eq: minted.id } } });
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
 * An owner with a project, an estate lent to it, and an artifact in it: the
 * whole of what a deploy names.
 */
const lentSetup = async (ctx: TestContext, deployAllowed: boolean) => {
  const owner = await createUser(ctx);
  const project = await createTestProject(ctx.alepha, { createdBy: owner.id });
  const estate = await createEstate(ctx, owner, "ovh-1", deployAllowed);
  await ctx.repos.grants.create({
    estateId: estate.id,
    projectId: project.id,
    createdBy: owner.id,
  });
  const artifact = await storeArtifact(ctx, project.id);
  return { owner, project, estate, artifact };
};

describe("EstateCommandController, enqueuing by hand", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("queues a restart for an instance on the caller's estate", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const estate = await createEstate(ctx, owner, "ovh-1", false);

    const queued = await ctx.commands.enqueueEstateCommand(
      {
        params: { estateId: estate.id },
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
    const { owner, estate, artifact } = await lentSetup(ctx, true);

    const queued = await ctx.commands.enqueueEstateCommand(
      {
        params: { estateId: estate.id },
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
        artifact: { id: artifact.id, sha256: "a".repeat(64), size: 42 },
      },
    });
  });

  it("refuses a deploy while the estate's switch is off, server-side", async ({
    expect,
  }) => {
    const { owner, estate, artifact } = await lentSetup(ctx, false);
    await expect(
      ctx.commands.enqueueEstateCommand(
        {
          params: { estateId: estate.id },
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
      await ctx.repos.estates.getOne({ where: { id: { eq: estate.id } } }),
    ).toBeDefined();
  });

  it("refuses a deploy when the estate is not lent to the artifact's project", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const project = await createTestProject(ctx.alepha, {
      createdBy: owner.id,
    });
    const estate = await createEstate(ctx, owner, "ovh-1", true);
    const artifact = await storeArtifact(ctx, project.id);

    await expect(
      ctx.commands.enqueueEstateCommand(
        {
          params: { estateId: estate.id },
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
    const { estate, artifact } = await lentSetup(ctx, true);
    // Another user who owns their own estate lent to nothing: the artifact
    // belongs to a project they cannot read.
    const stranger = await createUser(ctx);
    const theirs = await createEstate(ctx, stranger, "hetzner", true);

    await expect(
      ctx.commands.enqueueEstateCommand(
        {
          params: { estateId: theirs.id },
          body: {
            kind: "deploy",
            artifactId: artifact.id,
            environment: "production",
          },
        },
        { user: stranger },
      ),
    ).rejects.toThrow(ForbiddenError);
    // And the owner's estate is not theirs to command at all.
    await expect(
      ctx.commands.enqueueEstateCommand(
        {
          params: { estateId: estate.id },
          body: { kind: "restart", app: "demo", environment: "production" },
        },
        { user: stranger },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("answers 404 for an artifact that does not exist", async ({ expect }) => {
    const { owner, estate } = await lentSetup(ctx, true);
    await expect(
      ctx.commands.enqueueEstateCommand(
        {
          params: { estateId: estate.id },
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
 * The one verb that refuses instead of queueing.
 *
 * A log tail delivered three hours later, after nobody is looking, is worse
 * than an error: it is a read, and a stale read is worthless. This is where
 * the epic deliberately breaks the queue-and-redeliver pattern #E20 built,
 * and the refusal happens before any row exists.
 */
describe("EstateCommandController, logs", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const online = async (ctx: TestContext, estate: Estate) => {
    const now = new Date().toISOString();
    await ctx.repos.estates.updateById(estate.id, {
      connectedAt: now,
      lastSeenAt: now,
    });
  };

  it("refuses while the machine is offline, and queues nothing", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const estate = await createEstate(ctx, owner, "ovh-logs-off", false);

    await expect(
      ctx.commands.enqueueEstateCommand(
        {
          params: { estateId: estate.id },
          body: { kind: "logs", app: "demo", environment: "production" },
        },
        { user: owner },
      ),
    ).rejects.toThrow(/not connected/);

    const listed = await ctx.commands.listEstateCommands(
      { params: { estateId: estate.id } },
      { user: owner },
    );
    expect(listed.items).toEqual([]);
  });

  it("queues a bounded ask while the machine is connected, defaulting the line count", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const estate = await createEstate(ctx, owner, "ovh-logs-on", false);
    await online(ctx, estate);

    const command = await ctx.commands.enqueueEstateCommand(
      {
        params: { estateId: estate.id },
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
    const estate = await createEstate(ctx, owner, "ovh-logs-result", false);
    await online(ctx, estate);
    const command = await ctx.commands.enqueueEstateCommand(
      {
        params: { estateId: estate.id },
        body: { kind: "logs", app: "demo", environment: "production" },
      },
      { user: owner },
    );

    await expect(
      ctx.commands.getEstateCommandResult(
        { params: { estateId: estate.id, commandId: command.id } },
        { user: owner },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("answers a non-owner as if the estate did not exist", async ({
    expect,
  }) => {
    const ada = await createUser(ctx);
    const grace = await createUser(ctx);
    const estate = await createEstate(ctx, ada, "ovh-logs-mine", false);
    await online(ctx, estate);
    const command = await ctx.commands.enqueueEstateCommand(
      {
        params: { estateId: estate.id },
        body: { kind: "logs", app: "demo", environment: "production" },
      },
      { user: ada },
    );

    await expect(
      ctx.commands.getEstateCommandResult(
        { params: { estateId: estate.id, commandId: command.id } },
        { user: grace },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
