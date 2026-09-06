import { createHash } from "node:crypto";

import { Alepha } from "alepha";
import { FileService } from "alepha/api/files";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { packedArtifact } from "../../../test/fixtures/artifactTarball.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { artifacts } from "../entities/artifacts.ts";
import { estateCommands } from "../entities/estateCommands.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import { ArtifactService } from "../services/ArtifactService.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
import { EstateController } from "./EstateController.ts";

class Repos {
  estates = $repository(estates);
  artifacts = $repository(artifacts);
  commands = $repository(estateCommands);
}

interface TestContext {
  alepha: Alepha;
  base: string;
  files: FileService;
  commands: EstateCommandService;
  estateApi: EstateController;
  repos: Repos;
  entities: TestEntityRepositories;
}

/**
 * An enrolled machine: the row, with deploys allowed, and the secret it
 * dials with.
 */
interface Machine {
  estate: Estate;
  secret: string;
}

/**
 * A stored artifact and the facts a command names it by.
 */
interface StoredArtifact {
  id: string;
  sha256: string;
  size: number;
  bytes: Uint8Array;
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
    base: alepha.inject(NodeHttpServerProvider).hostname,
    files: alepha.inject(FileService),
    commands: alepha.inject(EstateCommandService),
    estateApi: alepha.inject(EstateController),
    repos,
    entities,
  };
};

const createOwner = async (ctx: TestContext): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({});
  return { id: user.id, roles: ["user"] };
};

const enrol = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
): Promise<Machine> => {
  const minted = await ctx.estateApi.createEstate({ body: { slug } }, { user });
  await ctx.repos.estates.updateById(minted.id, { deployAllowed: true });
  return {
    estate: await ctx.repos.estates.getOne({
      where: { id: { eq: minted.id } },
    }),
    secret: minted.secret,
  };
};

const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Bytes in the artifact bucket and a row naming them, the way
 * `ArtifactService.push` leaves them, without the push endpoint's manifest
 * checks in the way: what is under test is who may read the bytes back, not
 * what they contain.
 */
const storeArtifact = async (
  ctx: TestContext,
  projectId: number,
  tag: string,
): Promise<StoredArtifact> => {
  const file = await packedArtifact({ filler: crypto.randomUUID() });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = sha256Of(bytes);
  const stored = await ctx.files.uploadFile(file, {
    bucket: ArtifactService.BUCKET,
  });
  const row = await ctx.repos.artifacts.create({
    projectId,
    app: "my-app",
    tag,
    runtime: "node",
    sha256,
    size: bytes.length,
    fileId: stored.id,
  });
  return { id: row.id, sha256, size: bytes.length, bytes };
};

/**
 * A `deploy` queued for the machine and then pushed, so the command is in
 * the one state a machine legitimately holds it in. The default transport
 * reaches no socket, which is why the push is recorded by hand.
 */
const sentDeploy = async (
  ctx: TestContext,
  machine: Machine,
  artifact: StoredArtifact,
) => {
  const queued = await ctx.commands.enqueue(machine.estate, {
    kind: "deploy",
    payload: {
      app: "my-app",
      environment: "production",
      artifact: {
        id: artifact.id,
        sha256: artifact.sha256,
        size: artifact.size,
      },
    },
  });
  return ctx.commands.markSent(queued);
};

/**
 * A refusal minus its per-request id, which is the one field two identical
 * refusals legitimately differ on.
 */
const refusalOf = async (res: Response): Promise<unknown> => {
  const { requestId, ...rest } = (await res.json()) as Record<string, unknown>;
  void requestId;
  return rest;
};

const pull = (
  ctx: TestContext,
  what: "artifact" | "secrets",
  commandId: string,
  secret?: string,
): Promise<Response> =>
  fetch(`${ctx.base}/estates/commands/${commandId}/${what}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

describe("EstatePullController, the artifact bytes", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("streams the artifact a sent command names, with its size and digest", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, machine, artifact);

    const res = await pull(ctx, "artifact", command.id, machine.secret);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-artifact-sha256")).toBe(artifact.sha256);
    expect(res.headers.get("content-length")).toBe(String(artifact.size));
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(artifact.size);
    expect(sha256Of(body)).toBe(artifact.sha256);
  });

  it("still serves a command the machine has reported running", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, machine, artifact);
    await ctx.commands.ack(machine.estate.id, {
      id: command.id,
      status: "running",
      step: "downloading",
    });

    const res = await pull(ctx, "artifact", command.id, machine.secret);
    expect(res.status).toBe(200);
  });

  it("refuses a valid secret for another estate's command, identically to an absent one", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const a = await enrol(ctx, owner, "estate-a");
    const b = await enrol(ctx, owner, "estate-b");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, b, artifact);

    const foreign = await pull(ctx, "artifact", command.id, a.secret);
    expect(foreign.status).toBe(404);
    const unknown = await pull(ctx, "artifact", crypto.randomUUID(), a.secret);
    expect(unknown.status).toBe(404);
    expect(await refusalOf(foreign)).toEqual(await refusalOf(unknown));

    // The same command, from the estate it belongs to: the 404 above was the
    // scope, not the command.
    const own = await pull(ctx, "artifact", command.id, b.secret);
    expect(own.status).toBe(200);
  });

  it("answers the same 404 for a done command, a pending one, and one with nothing to pull", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");

    const done = await sentDeploy(ctx, machine, artifact);
    await ctx.commands.ack(machine.estate.id, { id: done.id, status: "done" });

    // Never pushed: the machine was not handed this one.
    const pending = await ctx.commands.enqueue(machine.estate, {
      kind: "deploy",
      payload: {
        app: "my-app",
        environment: "production",
        artifact: {
          id: artifact.id,
          sha256: artifact.sha256,
          size: artifact.size,
        },
      },
    });
    expect(pending.status).toBe("pending");

    // Sent, and the machine holds it, but a restart names no artifact.
    const restart = await ctx.commands.markSent(
      await ctx.commands.enqueue(machine.estate, {
        kind: "restart",
        payload: { app: "my-app", environment: "production" },
      }),
    );

    const answers = await Promise.all(
      [done.id, pending.id, restart.id].map((id) =>
        pull(ctx, "artifact", id, machine.secret),
      ),
    );
    const bodies = await Promise.all(answers.map(refusalOf));
    for (const res of answers) {
      expect(res.status).toBe(404);
    }
    for (const body of bodies) {
      expect(body).toEqual(bodies[0]);
    }
  });

  it("refuses when the artifact row no longer carries the digest the command promised", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, machine, artifact);

    // A forced re-push of the same tag moves the row onto other bytes.
    await ctx.repos.artifacts.updateById(artifact.id, {
      sha256: "f".repeat(64),
    });

    const res = await pull(ctx, "artifact", command.id, machine.secret);
    expect(res.status).toBe(404);
  });

  it("refuses a missing or unknown secret before looking at the command", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, machine, artifact);

    const anonymous = await pull(ctx, "artifact", command.id);
    expect(anonymous.status).toBe(401);
    const wrong = await pull(ctx, "artifact", command.id, "est_not_a_secret");
    expect(wrong.status).toBe(401);
  });
});

describe("EstatePullController, the secret set", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers an empty set, never cacheable, for a command the machine holds", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, machine, artifact);

    const res = await pull(ctx, "secrets", command.id, machine.secret);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({});
  });

  it("is scoped exactly like the artifact: another estate's secret and a done command are the same 404", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const a = await enrol(ctx, owner, "estate-a");
    const b = await enrol(ctx, owner, "estate-b");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, b, artifact);

    const foreign = await pull(ctx, "secrets", command.id, a.secret);
    expect(foreign.status).toBe(404);

    await ctx.commands.ack(b.estate.id, { id: command.id, status: "done" });
    const finished = await pull(ctx, "secrets", command.id, b.secret);
    expect(finished.status).toBe(404);
    expect(await refusalOf(foreign)).toEqual(await refusalOf(finished));

    const anonymous = await pull(ctx, "secrets", command.id);
    expect(anonymous.status).toBe(401);
  });
});

/**
 * A `logs` command queued and pushed, so it is in one of the two states a
 * machine legitimately holds it in.
 */
const sentLogs = async (ctx: TestContext, machine: Machine) => {
  const queued = await ctx.commands.enqueue(machine.estate, {
    kind: "logs",
    payload: {
      app: "my-app",
      environment: "production",
      logs: { lines: 200 },
    },
  });
  return ctx.commands.markSent(queued);
};

const pushResult = (
  ctx: TestContext,
  commandId: string,
  body: string,
  secret?: string,
): Promise<Response> =>
  fetch(`${ctx.base}/estates/commands/${commandId}/result`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body,
  });

/**
 * The one command whose answer is a payload rather than an ack.
 *
 * The protocol has no reply channel, so the answer comes back over this
 * machine-facing seam, addressed by command id under the estate secret. Every
 * rule the sibling routes hold is asserted here too, because the reason for
 * them is the same: a machine must learn nothing about another estate's queue
 * from the difference between "not yours" and "not there".
 */
describe("EstatePullController, a command's result", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("stores the answer of a command the machine holds, and links it to the row", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const machine = await enrol(ctx, owner, "ovh-logs");
    const command = await sentLogs(ctx, machine);

    const res = await pushResult(
      ctx,
      command.id,
      JSON.stringify({
        supervised: true,
        lines: [{ raw: "boot" }, { raw: "ready" }],
      }),
      machine.secret,
    );

    expect(res.status, await res.text()).toBe(200);
    const row = await ctx.repos.commands.getOne({
      where: { id: { eq: command.id } },
    });
    expect(row.resultFileId).toBeDefined();
    // Kept for a day and swept by the framework, which is why the queue's own
    // sweep needs to know nothing about it.
    const file = await ctx.files.getFileById(row.resultFileId!);
    expect(file.expirationDate).toBeDefined();
  });

  /**
   * Accepted once. A redelivered upload must not replace an answer the owner
   * may already be reading.
   */
  it("refuses a second upload for the same command", async ({ expect }) => {
    const owner = await createOwner(ctx);
    const machine = await enrol(ctx, owner, "ovh-logs-twice");
    const command = await sentLogs(ctx, machine);

    const first = `{"supervised":true,"lines":[{"raw":"first"}]}`;
    expect(
      (await pushResult(ctx, command.id, first, machine.secret)).status,
    ).toBe(200);
    const second = await pushResult(
      ctx,
      command.id,
      `{"supervised":true,"lines":[{"raw":"second"}]}`,
      machine.secret,
    );
    expect(second.status).toBe(404);

    const row = await ctx.repos.commands.getOne({
      where: { id: { eq: command.id } },
    });
    const stored = await ctx.files.streamFile(row.resultFileId!);
    expect(await stored.text()).toContain("first");
  });

  /**
   * The ordering both halves agree on: upload, THEN ack. `resolve()` accepts
   * a command only while it is sent or running, so an answer arriving after
   * the terminal ack has nowhere to go.
   */
  it("refuses an upload for a command that already finished", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const machine = await enrol(ctx, owner, "ovh-logs-late");
    const command = await sentLogs(ctx, machine);
    await ctx.commands.ack(machine.estate.id, {
      id: command.id,
      status: "done",
    });

    const res = await pushResult(
      ctx,
      command.id,
      `{"supervised":true,"lines":[{"raw":"late"}]}`,
      machine.secret,
    );
    expect(res.status).toBe(404);
  });

  it("refuses another estate's command, an unknown id and a missing secret identically", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const mine = await enrol(ctx, owner, "ovh-logs-mine");
    const theirs = await enrol(ctx, owner, "ovh-logs-theirs");
    const command = await sentLogs(ctx, mine);

    const body = `{"supervised":true,"lines":[{"raw":"x"}]}`;
    const foreign = await pushResult(ctx, command.id, body, theirs.secret);
    const unknown = await pushResult(
      ctx,
      crypto.randomUUID(),
      body,
      theirs.secret,
    );
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    // Identical bodies: the difference between "not yours" and "not there" is
    // exactly what a machine must not be able to measure.
    expect(await refusalOf(foreign)).toEqual(await refusalOf(unknown));

    expect((await pushResult(ctx, command.id, body)).status).toBe(401);
  });
});
