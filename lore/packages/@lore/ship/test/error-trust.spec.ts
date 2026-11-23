import { jobKeys } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  LoreShipApi,
  ProjectErrorController,
  SigilIngestService,
} from "../src/api/index.ts";
import { projectErrors, type Sigil, sigils } from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repos {
  sigils = $repository(sigils);
  errors = $repository(projectErrors);
  keys = $repository(jobKeys);
}

const setup = async () => {
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
  const created = await entities.users.create({});
  const owner: UserAccountToken = { id: created.id, roles: ["user"] };
  const project = await createTestProject(alepha, { createdBy: owner.id });
  const sigil: Sigil = await repos.sigils.create({
    projectId: project.id,
    name: "acme/production",
    tokenHash: "hash-trust",
    tokenPrefix: "sg_trust",
    kinds: ["errors"],
  });
  return {
    alepha,
    repos,
    owner,
    projectId: project.id,
    sigil,
    controller: alepha.inject(ProjectErrorController),
    ingest: alepha.inject(SigilIngestService),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const report = (w: World, message: string) =>
  w.ingest.absorb(w.sigil, {
    errors: [
      {
        name: "TypeError",
        message,
        // The fingerprint is the name and the first frame: one frame per
        // message makes one group per message.
        stack: `TypeError: ${message}\n    at ${message} (app.js:12:3)`,
        sourceUrl: "https://acme.example/cart",
        origin: "client",
      },
    ],
  } as never);

/**
 * The caller an agent's job key makes: an API key whose `job_keys` row pins
 * it to the project (#Q3995).
 */
const asJob = async (w: World): Promise<UserAccountToken> => {
  const apiKeyId = crypto.randomUUID();
  await w.repos.keys.create({
    apiKeyId,
    jobId: crypto.randomUUID(),
    projectId: w.projectId,
    userId: w.owner.id,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return {
    ...w.owner,
    credential: { type: "api-key", id: apiKeyId },
  } as UserAccountToken;
};

/**
 * Error text comes from an ingest open to anyone (#Q4233): no agent reads a
 * group until a member trusted it, the same rule as a feedback item's
 * (#Q4216).
 */
describe("error group Trust", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("lists only trusted groups to a job key, and says how many wait", async ({
    expect,
  }) => {
    await report(w, "first");
    await report(w, "second");
    const [first] = await w.repos.errors.findMany({
      where: { message: { eq: "first" } },
    });
    if (!first) throw new Error("no group");

    const member = await w.controller.listProjectErrors.run(
      { params: { projectId: w.projectId }, query: {} },
      { user: w.owner },
    );
    expect(member.items).toHaveLength(2);
    expect(member.awaitingTrust).toBe(2);

    const job = await asJob(w);
    const before = await w.controller.listProjectErrors.run(
      { params: { projectId: w.projectId }, query: {} },
      { user: job },
    );
    expect(before.items).toEqual([]);
    expect(before.awaitingTrust).toBe(2);
    // An untrusted group cannot be acted on with a key either.
    await expect(
      w.controller.resolveProjectError.run(
        { params: { projectId: w.projectId, errorId: first.id } },
        { user: job },
      ),
    ).rejects.toThrow("is not trusted yet");
    await expect(
      w.controller.forwardProjectErrorToQuest.run(
        { params: { projectId: w.projectId, errorId: first.id }, body: {} },
        { user: job },
      ),
    ).rejects.toThrow("is not trusted yet");

    const trusted = await w.controller.trustProjectError.run(
      { params: { projectId: w.projectId, errorId: first.id } },
      { user: w.owner },
    );
    expect(trusted.trustedBy).toBe(w.owner.id);

    const after = await w.controller.listProjectErrors.run(
      { params: { projectId: w.projectId }, query: {} },
      { user: job },
    );
    expect(after.items.map((it) => it.message)).toEqual(["first"]);
    expect(after.items[0]?.trustedAt).toBe(trusted.trustedAt);
    expect(after.awaitingTrust).toBe(1);
  });

  it("refuses an API key, a job key and an MCP token: a person trusts, never a machine", async ({
    expect,
  }) => {
    await report(w, "boom");
    const [row] = await w.repos.errors.findMany({});
    if (!row) throw new Error("no group");
    for (const credential of [
      { type: "api-key", id: "key-1" },
      { type: "oauth", clientId: "mcp-client" },
    ]) {
      await expect(
        w.controller.trustProjectError.run(
          { params: { projectId: w.projectId, errorId: row.id } },
          { user: { ...w.owner, credential } as UserAccountToken },
        ),
      ).rejects.toThrow(/signed-in session/);
    }
    const unchanged = await w.repos.errors.getOne({
      where: { id: { eq: row.id } },
    });
    expect(unchanged.trustedAt).toBeFalsy();
  });

  it("keeps a group's trust when it is reported again, and a new group starts untrusted", async ({
    expect,
  }) => {
    await report(w, "boom");
    const [row] = await w.repos.errors.findMany({});
    if (!row) throw new Error("no group");
    await w.controller.trustProjectError.run(
      { params: { projectId: w.projectId, errorId: row.id } },
      { user: w.owner },
    );
    await report(w, "boom");
    await report(w, "another");
    const again = await w.repos.errors.getOne({
      where: { id: { eq: row.id } },
    });
    expect(again.trustedAt).toBeTruthy();
    expect(again.count).toBe(2);
    const fresh = await w.repos.errors.findMany({
      where: { message: { eq: "another" } },
    });
    expect(fresh[0]?.trustedAt).toBeFalsy();
  });
});
