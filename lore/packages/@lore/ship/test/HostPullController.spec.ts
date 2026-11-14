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

import { LoreShipApi } from "../src/api/index.ts";
import {
  AppSecretService,
  ArtifactService,
  DeployService,
  HostCommandService,
  HostController,
} from "../src/api/index.ts";
import {
  appInstances,
  appSecrets,
  artifacts,
  deployments,
  hostCommands,
  type Host,
  hosts,
} from "../src/schemas/index.ts";
import { createTestHost } from "../src/testing/hosts.ts";
import { packedArtifact } from "../src/testing/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repos {
  hosts = $repository(hosts);
  artifacts = $repository(artifacts);
  commands = $repository(hostCommands);
  instances = $repository(appInstances);
  secrets = $repository(appSecrets);
  deployments = $repository(deployments);
}

interface TestContext {
  alepha: Alepha;
  base: string;
  files: FileService;
  commands: HostCommandService;
  hostApi: HostController;
  repos: Repos;
  entities: DeployTestEntities;
}

/**
 * An enrolled machine: the row, with deploys allowed, and the secret it
 * dials with.
 */
interface Machine {
  host: Host;
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
    env: {
      LOG_LEVEL: "error",
      DATABASE_URL: ":memory:",
      // ⚠️ `CredentialSealService` refuses the published default in every
      // environment, so a spec that seals a value has to set one.
      APP_SECRET: "a-strong-and-unique-app-secret-for-tests",
    },
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
    base: alepha.inject(NodeHttpServerProvider).hostname,
    files: alepha.inject(FileService),
    commands: alepha.inject(HostCommandService),
    hostApi: alepha.inject(HostController),
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
  const minted = await createTestHost(ctx.alepha, user, { slug });
  await ctx.repos.hosts.updateById(minted.id, { deployAllowed: true });
  return {
    host: await ctx.repos.hosts.getOne({
      where: { id: { eq: minted.id } },
    }),
    secret: minted.secret!,
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
  const queued = await ctx.commands.enqueue(machine.host, {
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
 * A copy holding what a first Cloudflare deploy stores for it, APP_SECRET and
 * APP_NAME, plus one variable of the operator's, since pointed at this
 * machine's host.
 *
 * The rows are written BEFORE the move because the Environment tab refuses
 * Bay's names on a Bay copy: this is a state a copy arrives in, never one it
 * can be put in once it is there.
 */
const movedToBay = async (
  ctx: TestContext,
  projectId: number,
  machine: Machine,
) => {
  const instance = await ctx.repos.instances.create({
    projectId,
    app: "my-app",
    env: "production",
  });
  const secrets = ctx.alepha.inject(AppSecretService);
  // What `DeployService.openSecrets` leaves behind on a deploy.
  await secrets.ensureGenerated(instance.id);
  await secrets.ensureDefault(
    instance.id,
    DeployService.APP_NAME,
    "acme-my-app-production",
  );
  await secrets.set({
    instanceId: instance.id,
    key: "STRIPE_SECRET_KEY",
    value: "sk_live_abcdefghijkl",
  });
  await ctx.repos.instances.updateById(instance.id, {
    hostId: machine.host.id,
  });
  return instance;
};

/**
 * A refusal minus its per-request id, which is the one field two identical
 * refusals legitimately differ on.
 */
const refusalOf = async (res: Response): Promise<unknown> => {
  const body = (await res.json()) as {
    data?: Record<string, unknown>;
  } & Record<string, unknown>;
  const { requestId, ...data } = body.data ?? {};
  void requestId;
  return { ...body, data };
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

describe("HostPullController, the artifact bytes", () => {
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
    await ctx.commands.ack(machine.host.id, {
      id: command.id,
      status: "running",
      step: "downloading",
    });

    const res = await pull(ctx, "artifact", command.id, machine.secret);
    expect(res.status).toBe(200);
  });

  it("refuses a valid secret for another host's command, identically to an absent one", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const a = await enrol(ctx, owner, "host-a");
    const b = await enrol(ctx, owner, "host-b");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, b, artifact);

    const foreign = await pull(ctx, "artifact", command.id, a.secret);
    expect(foreign.status).toBe(404);
    const unknown = await pull(ctx, "artifact", crypto.randomUUID(), a.secret);
    expect(unknown.status).toBe(404);
    expect(await refusalOf(foreign)).toEqual(await refusalOf(unknown));

    // The same command, from the host it belongs to: the 404 above was the
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
    await ctx.commands.ack(machine.host.id, { id: done.id, status: "done" });

    // Never pushed: the machine was not handed this one.
    const pending = await ctx.commands.enqueue(machine.host, {
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
      await ctx.commands.enqueue(machine.host, {
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

describe("HostPullController, the secret set", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers an empty set, never cacheable, for a command that names no copy", async ({
    expect,
  }) => {
    // ⚠️ Empty rather than a refusal. `restart`, `logs` and `stop` name a Bay
    // instance by the two strings the operator typed, not by a row, so a
    // machine executing one must not be told "no such command" for asking a
    // question whose honest answer is nothing.
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

  it("answers the copy's own set when the command names one", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");

    // The copy the command's `(app, environment)` names, on this host.
    const instance = await ctx.repos.instances.create({
      projectId: project.id,
      app: "my-app",
      env: "production",
      hostId: machine.host.id,
    });
    await ctx.alepha.inject(AppSecretService).set({
      instanceId: instance.id,
      key: "STRIPE_SECRET_KEY",
      value: "sk_live_abcdefghijkl",
    });

    const command = await sentDeploy(ctx, machine, artifact);
    const res = await pull(ctx, "secrets", command.id, machine.secret);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      STRIPE_SECRET_KEY: "sk_live_abcdefghijkl",
    });
  });

  it("leaves out what Bay writes itself, which a first Cloudflare deploy stored", async ({
    expect,
  }) => {
    // ⚠️ A copy first deployed on a Cloudflare host carries APP_SECRET and
    // APP_NAME, stored by that deploy, and keeps them when it is pointed at a
    // Bay host. Bay refuses a secret set holding either (`refuseBayOwned`)
    // and fails the whole deploy, so answering them fails every Bay deploy of
    // that copy.
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    await movedToBay(ctx, project.id, machine);

    const command = await sentDeploy(ctx, machine, artifact);
    const res = await pull(ctx, "secrets", command.id, machine.secret);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      STRIPE_SECRET_KEY: "sk_live_abcdefghijkl",
    });
  });

  it("never opens a row it leaves out, so a stale one cannot refuse the deploy", async ({
    expect,
  }) => {
    // ⚠️ A row that fails to open refuses the whole set, and the fix that
    // refusal names is setting the value again - which the Environment tab
    // refuses for a Bay-owned name on a Bay copy. So a stale APP_SECRET row
    // must not be decrypted at all on a path that would only drop it.
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const instance = await movedToBay(ctx, project.id, machine);

    const generated = await ctx.repos.secrets.getOne({
      where: {
        instanceId: { eq: instance.id },
        key: { eq: AppSecretService.GENERATED_KEY },
      },
    });
    await ctx.repos.secrets.updateById(generated.id, {
      valueSealed: "00:00:deadbeef",
    });

    const command = await sentDeploy(ctx, machine, artifact);
    const res = await pull(ctx, "secrets", command.id, machine.secret);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({
      STRIPE_SECRET_KEY: "sk_live_abcdefghijkl",
    });
  });

  it("refuses when the host carries two copies of the same name", async ({
    expect,
  }) => {
    // ⚠️ Two projects lending one host can each name `my-app/production` on
    // it. Taking the first row would hand one project's production secrets to
    // the other's machine, so ambiguity is refused rather than resolved.
    const owner = await createOwner(ctx);
    const one = await createTestProject(ctx.alepha);
    const two = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, one.id, "1.0.0");

    for (const project of [one, two]) {
      await ctx.repos.instances.create({
        projectId: project.id,
        app: "my-app",
        env: "production",
        hostId: machine.host.id,
      });
    }

    const command = await sentDeploy(ctx, machine, artifact);
    const res = await pull(ctx, "secrets", command.id, machine.secret);

    expect(res.status).toBe(404);
  });

  it("is scoped exactly like the artifact: another host's secret and a done command are the same 404", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const a = await enrol(ctx, owner, "host-a");
    const b = await enrol(ctx, owner, "host-b");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, b, artifact);

    const foreign = await pull(ctx, "secrets", command.id, a.secret);
    expect(foreign.status).toBe(404);

    await ctx.commands.ack(b.host.id, { id: command.id, status: "done" });
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
  const queued = await ctx.commands.enqueue(machine.host, {
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
 * machine-facing seam, addressed by command id under the host secret. Every
 * rule the sibling routes hold is asserted here too, because the reason for
 * them is the same: a machine must learn nothing about another host's queue
 * from the difference between "not yours" and "not there".
 */
describe("HostPullController, a command's result", () => {
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
    await ctx.commands.ack(machine.host.id, {
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

  it("refuses another host's command, an unknown id and a missing secret identically", async ({
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

const pullAppSecret = (
  ctx: TestContext,
  commandId: string,
  secret: string,
  withValue = false,
): Promise<Response> =>
  fetch(
    `${ctx.base}/estates/commands/${commandId}/app-secret${withValue ? "?value=1" : ""}`,
    { headers: { authorization: `Bearer ${secret}` } },
  );

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * The key a rebuilt Bay host takes back from Lore, on its own route and never
 * inside the secret set, so a Bay older than the route keeps deploying.
 */
describe("HostPullController, the app secret", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers nothing, never cacheable, for a copy Lore holds no key for", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const command = await sentDeploy(ctx, machine, artifact);

    const res = await pullAppSecret(ctx, command.id, machine.secret, true);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({});
  });

  it("answers the hash on a routine deploy, and the key only when asked", async ({
    expect,
  }) => {
    // A copy moved from a Cloudflare host: its key was minted there, and
    // is the one its sessions and sealed data were signed with.
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const instance = await movedToBay(ctx, project.id, machine);
    const key = await ctx.alepha
      .inject(AppSecretService)
      .openGenerated(instance.id);
    const command = await sentDeploy(ctx, machine, artifact);

    const routine = await pullAppSecret(ctx, command.id, machine.secret);
    expect(routine.status).toBe(200);
    expect(await routine.json()).toEqual({ sha256: sha256Hex(key!) });

    const rebuilt = await pullAppSecret(ctx, command.id, machine.secret, true);
    expect(rebuilt.headers.get("cache-control")).toBe("no-store");
    expect(await rebuilt.json()).toEqual({
      sha256: sha256Hex(key!),
      value: key,
    });
  });

  it("leaves the secret set without APP_SECRET, unchanged", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    await movedToBay(ctx, project.id, machine);
    const command = await sentDeploy(ctx, machine, artifact);

    const set = await (
      await pull(ctx, "secrets", command.id, machine.secret)
    ).json();

    expect(set).not.toHaveProperty("APP_SECRET");
  });

  it("refuses when the host carries two copies of the same name", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const one = await createTestProject(ctx.alepha);
    const two = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, one.id, "1.0.0");
    for (const project of [one, two]) {
      await ctx.repos.instances.create({
        projectId: project.id,
        app: "my-app",
        env: "production",
        hostId: machine.host.id,
      });
    }
    const command = await sentDeploy(ctx, machine, artifact);

    const res = await pullAppSecret(ctx, command.id, machine.secret, true);

    expect(res.status).toBe(404);
  });

  it("refuses a command that is not a deploy, and another host's deploy", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const other = await enrol(ctx, owner, "ovh-2");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    await movedToBay(ctx, project.id, machine);
    const logs = await sentLogs(ctx, machine);
    const deploy = await sentDeploy(ctx, machine, artifact);

    expect(
      (await pullAppSecret(ctx, logs.id, machine.secret, true)).status,
    ).toBe(404);
    expect(
      (await pullAppSecret(ctx, deploy.id, other.secret, true)).status,
    ).toBe(404);
  });

  it("answers a stack member through payload.instanceId, only when its deploy row carries the command", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    // A member's host is its stack environment's, so the copy's own
    // host is empty and the name lookup could not find it.
    const member = await ctx.repos.instances.create({
      projectId: project.id,
      app: "my-app",
      env: "production",
    });
    await ctx.alepha.inject(AppSecretService).ensureGenerated(member.id);
    const key = await ctx.alepha
      .inject(AppSecretService)
      .openGenerated(member.id);
    const deployFor = async () =>
      ctx.commands.markSent(
        await ctx.commands.enqueue(machine.host, {
          kind: "deploy",
          payload: {
            app: "my-app",
            environment: "production",
            instanceId: member.id,
            artifact: {
              id: artifact.id,
              sha256: artifact.sha256,
              size: artifact.size,
            },
          },
        }),
      );

    const stray = await deployFor();
    expect(
      (await pullAppSecret(ctx, stray.id, machine.secret, true)).status,
    ).toBe(404);

    const carried = await deployFor();
    await ctx.repos.deployments.create({
      projectId: project.id,
      instanceId: member.id,
      app: "my-app",
      tag: "1.0.0",
      sha256: artifact.sha256,
      status: "running",
      commandId: carried.id,
    });
    const res = await pullAppSecret(ctx, carried.id, machine.secret, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha256: sha256Hex(key!), value: key });
  });
});

const escrow = (
  ctx: TestContext,
  commandId: string,
  secret: string,
  value: string,
): Promise<Response> =>
  fetch(`${ctx.base}/estates/commands/${commandId}/app-secret`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ value }),
  });

/**
 * Lore's row follows the machine: Bay mints for a Bay copy and escrows the key
 * it runs on, so the row is always the running key.
 */
describe("HostPullController, the app secret escrow", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const bayCopy = async (machine: Machine, projectId: number) =>
    ctx.repos.instances.create({
      projectId,
      app: "my-app",
      env: "production",
      hostId: machine.host.id,
    });

  it("stores the machine's key sealed only, with nobody named as its author", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const instance = await bayCopy(machine, project.id);
    const command = await sentDeploy(ctx, machine, artifact);

    const res = await escrow(
      ctx,
      command.id,
      machine.secret,
      "the-machine-key-0123456789",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: true, replaced: false });
    const row = await ctx.repos.secrets.getOne({
      where: {
        instanceId: { eq: instance.id },
        key: { eq: AppSecretService.GENERATED_KEY },
      },
    });
    expect(row.value ?? undefined).toBeUndefined();
    expect(row.updatedBy ?? undefined).toBeUndefined();
    expect(row.valueSealed).not.toContain("the-machine-key");
    const back = await pullAppSecret(ctx, command.id, machine.secret);
    expect(await back.json()).toEqual({
      sha256: sha256Hex("the-machine-key-0123456789"),
    });
  });

  it("stores nothing when Lore already holds that key", async ({ expect }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    await bayCopy(machine, project.id);
    const command = await sentDeploy(ctx, machine, artifact);
    await escrow(ctx, command.id, machine.secret, "same-key-0123456789");

    const again = await escrow(
      ctx,
      command.id,
      machine.secret,
      "same-key-0123456789",
    );

    expect(await again.json()).toEqual({ stored: false, replaced: false });
  });

  it("replaces a different key and says so on the deploy's log, without the value", async ({
    expect,
  }) => {
    // A copy moved from Cloudflare holds the key of that life; the machine
    // runs another one, and the machine's wins.
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const instance = await movedToBay(ctx, project.id, machine);
    const command = await sentDeploy(ctx, machine, artifact);
    const deployment = await ctx.repos.deployments.create({
      projectId: project.id,
      instanceId: instance.id,
      app: "my-app",
      tag: "1.0.0",
      sha256: artifact.sha256,
      status: "running",
      commandId: command.id,
    });

    const res = await escrow(
      ctx,
      command.id,
      machine.secret,
      "the-machine-key-0123456789",
    );

    expect(await res.json()).toEqual({ stored: true, replaced: true });
    const key = await ctx.alepha
      .inject(AppSecretService)
      .openGenerated(instance.id);
    expect(key).toBe("the-machine-key-0123456789");
    const log = (
      await ctx.repos.deployments.getOne({
        where: { id: { eq: deployment.id } },
      })
    ).log;
    const line = log.at(-1)?.text ?? "";
    expect(line).toContain("Lore held another APP_SECRET");
    expect(JSON.stringify(log)).not.toContain("the-machine-key");
  });

  it("refuses a command with no copy, a command that is not a deploy, and another host's", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const other = await enrol(ctx, owner, "ovh-2");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const orphan = await sentDeploy(ctx, machine, artifact);
    expect(
      (await escrow(ctx, orphan.id, machine.secret, "k-0123456789")).status,
    ).toBe(404);

    await bayCopy(machine, project.id);
    const logs = await sentLogs(ctx, machine);
    const deploy = await sentDeploy(ctx, machine, artifact);
    expect(
      (await escrow(ctx, logs.id, machine.secret, "k-0123456789")).status,
    ).toBe(404);
    expect(
      (await escrow(ctx, deploy.id, other.secret, "k-0123456789")).status,
    ).toBe(404);
  });

  it("escrows a stack member through payload.instanceId, only when its deploy row carries the command", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const project = await createTestProject(ctx.alepha);
    const machine = await enrol(ctx, owner, "ovh-1");
    const artifact = await storeArtifact(ctx, project.id, "1.0.0");
    const member = await ctx.repos.instances.create({
      projectId: project.id,
      app: "my-app",
      env: "production",
    });
    const deployFor = async () =>
      ctx.commands.markSent(
        await ctx.commands.enqueue(machine.host, {
          kind: "deploy",
          payload: {
            app: "my-app",
            environment: "production",
            instanceId: member.id,
            artifact: {
              id: artifact.id,
              sha256: artifact.sha256,
              size: artifact.size,
            },
          },
        }),
      );

    const stray = await deployFor();
    expect(
      (await escrow(ctx, stray.id, machine.secret, "member-key-0123456789"))
        .status,
    ).toBe(404);

    const carried = await deployFor();
    await ctx.repos.deployments.create({
      projectId: project.id,
      instanceId: member.id,
      app: "my-app",
      tag: "1.0.0",
      sha256: artifact.sha256,
      status: "running",
      commandId: carried.id,
    });
    const res = await escrow(
      ctx,
      carried.id,
      machine.secret,
      "member-key-0123456789",
    );
    expect(await res.json()).toEqual({ stored: true, replaced: false });
    expect(
      await ctx.alepha.inject(AppSecretService).openGenerated(member.id),
    ).toBe("member-key-0123456789");
  });
});
