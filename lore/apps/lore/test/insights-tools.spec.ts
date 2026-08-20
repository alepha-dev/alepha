import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { blights } from "../src/api/entities/blights.ts";
import { sigilErrorGroups } from "../src/api/entities/sigilErrorGroups.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { LoreApi } from "../src/api/index.ts";
import { SigilTokenService } from "../src/api/services/SigilTokenService.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { BlightTools } from "../src/mcp/tools/BlightTools.ts";
import { InsightsTools } from "../src/mcp/tools/InsightsTools.ts";

/**
 * The error budget over MCP.
 *
 * These exist for one question `blight_list` structurally cannot answer: is
 * this failure still happening, and in which app. The inbox merges apps on
 * purpose so a triage decision cannot fork; that merge is
 * exactly what makes it blind to "fixed in staging, still burning in prod".
 */

class Probe {
  sigils = $repository(sigils);
  errorGroups = $repository(sigilErrorGroups);
  blights = $repository(blights);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const probe = alepha.inject(Probe);
  const tokens = alepha.inject(SigilTokenService);
  const insightsTools = alepha.inject(InsightsTools);
  const blightTools = alepha.inject(BlightTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>) =>
    asUser(owner.id, () => tool.execute(params));

  const project = await asUser(owner.id, () =>
    projectApi.createProject({ body: { title: "Insights" } } as any),
  );
  const otherProject = await asUser(owner.id, () =>
    projectApi.createProject({ body: { title: "Elsewhere" } } as any),
  );

  const enrol = async (name: string) => {
    const minted = await tokens.mint(project.id);
    return await probe.sigils.create({
      projectId: project.id,
      name,
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      kinds: ["beacon", "vitals", "blights", "feedback"],
    });
  };

  /** The same failure, seen by one app. */
  const reportError = async (
    sigilId: string,
    over: Record<string, unknown> = {},
  ) =>
    await probe.errorGroups.create({
      sigilId,
      fingerprint: "fp-shared",
      name: "TypeError",
      message: "Cannot read properties of undefined",
      stackSample: "TypeError\n    at cart",
      sourceUrl: "https://demo.example.com/cart",
      origin: "client",
      count: 3,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      ...over,
    } as any);

  return {
    alepha,
    probe,
    project,
    otherProject,
    call,
    insightsTools,
    blightTools,
    enrol,
    reportError,
  };
};

describe("Lore MCP — insights", () => {
  it("should keep apps apart, where the blights inbox merges them", async () => {
    /*
      The whole reason this tool exists. One fingerprint, two apps:
      the inbox is right to show a single row — the decision must not fork —
      and that is precisely why it cannot answer "is production still
      affected". These groups can.
    */
    const { project, call, insightsTools, enrol, reportError } = await setup();
    const staging = await enrol("demo-staging");
    const production = await enrol("demo-production");
    await reportError(staging.id);
    await reportError(production.id);

    const res = await call(insightsTools.insights_read, {
      project: project.id,
      segments: ["errors"],
    });

    expect(res.errorGroups).toHaveLength(2);
    expect(res.errorGroups.map((g: any) => g.sigilLabel).sort()).toEqual([
      "demo-production",
      "demo-staging",
    ]);
    // Named, not a uuid: an answer an operator can act on without a lookup.
    expect(res.errorGroups[0].fingerprint).toBe("fp-shared");
  });

  it("should return only the segments asked for", async () => {
    // The analytics segment is the largest and the least often needed. A
    // caller checking whether a bug is live should not pay for a timeline.
    const { project, call, insightsTools, enrol, reportError } = await setup();
    await reportError((await enrol("demo-production")).id);

    const res = await call(insightsTools.insights_read, {
      project: project.id,
      segments: ["errors"],
    });

    expect(res.errorGroups).toBeDefined();
    expect(res.vitals).toBeUndefined();
    expect(res.analytics).toBeUndefined();
  });

  it("should return all three segments by default", async () => {
    const { project, call, insightsTools, enrol, reportError } = await setup();
    await reportError((await enrol("demo-production")).id);

    const res = await call(insightsTools.insights_read, {
      project: project.id,
    });

    expect(res.errorGroups).toBeDefined();
    expect(res.vitals).toBeDefined();
    expect(res.analytics).toBeDefined();
  });

  it("should refuse a project the caller is not a member of", async () => {
    // Every other Lore surface is membership-gated; an analytics read that was
    // not would be the one way to enumerate another project's traffic.
    const { insightsTools, otherProject, alepha } = await setup();
    const users = alepha.inject(UserService);
    const stranger = await users.createUser({ username: "stranger" });

    await expect(
      alepha.context.run(() => {
        alepha.store.set(currentUserAtom, {
          id: stranger.id,
          roles: ["user"],
        } as any);
        return insightsTools.insights_read.execute({
          project: otherProject.id,
        });
      }),
    ).rejects.toThrow();
  });
});
