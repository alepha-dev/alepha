import type { SigilForwarded } from "@alepha/lore/sigil";
import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, expect, it } from "vitest";

import { LoreShipApi } from "../src/api/index.ts";
import { SigilIngestService, SigilTokenService } from "../src/api/index.ts";
import { LoreShipMcp } from "../src/mcp/index.ts";
import { ProjectErrorTools, InsightsTools } from "../src/mcp/index.ts";
import {
  appInstances,
  projectErrors,
  sigilErrorGroups,
  sigils,
} from "../src/schemas/index.ts";

/**
 * The error budget over MCP.
 *
 * These exist for one question `error_list` structurally cannot answer: is
 * this failure still happening, and in which app. The inbox merges apps on
 * purpose so a triage decision cannot fork; that merge is
 * exactly what makes it blind to "fixed in staging, still burning in prod".
 */

class Probe {
  sigils = $repository(sigils);
  instances = $repository(appInstances);
  errorGroups = $repository(sigilErrorGroups);
  projectErrors = $repository(projectErrors);
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
  alepha.with(LoreShipApi);
  alepha.with(LoreShipMcp);

  const probe = alepha.inject(Probe);
  const tokens = alepha.inject(SigilTokenService);
  const insightsTools = alepha.inject(InsightsTools);
  const projectErrorTools = alepha.inject(ProjectErrorTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] });
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>) =>
    asUser(owner.id, () => tool.execute(params));

  const project = await asUser(owner.id, () =>
    projectApi.createProject({
      body: {
        title: "Insights",
        // Ingest keeps views only under Ship's tracking option.
        capabilities: [{ key: "ship", options: { track: true } }],
      },
    }),
  );
  const otherProject = await asUser(owner.id, () =>
    projectApi.createProject({ body: { title: "Elsewhere" } }),
  );

  const enrol = async (name: string) => {
    const minted = await tokens.mint(project.id);
    return await probe.sigils.create({
      projectId: project.id,
      name,
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      kinds: ["beacon", "vitals", "errors", "feedback"],
    });
  };

  /**
   * The same failure, seen by one app.
   */
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
    });

  /**
   * A deployed copy with its sigil, and one visit of one visitor through
   * the real ingest.
   */
  const copyWithVisit = async (
    app: string,
    env: string,
    visitors: string[],
  ) => {
    const sigil = await enrol(`${app}/${env}`);
    await probe.instances.create({
      projectId: project.id,
      app,
      env,
      sigilId: sigil.id,
    });
    for (const visitor of visitors) {
      await alepha.inject(SigilIngestService).absorb(sigil, {
        visitor,
        traffic: "human",
        views: [{ path: "/", entry: true }],
      } as SigilForwarded);
    }
    return sigil;
  };

  return {
    alepha,
    probe,
    copyWithVisit,
    project,
    otherProject,
    call,
    insightsTools,
    projectErrorTools,
    enrol,
    reportError,
  };
};

describe("Lore MCP — insights", () => {
  it("reads one copy by app and env over a custom window, with the v2 analytics", async () => {
    const { project, call, insightsTools, copyWithVisit } = await setup();
    await copyWithVisit("demo", "production", ["alice"]);
    await copyWithVisit("demo", "staging", ["bob", "carol"]);
    const today = new Date().toISOString().slice(0, 10);

    const res = await call(insightsTools.insights_read, {
      project: project.id,
      app: "demo",
      from: today,
      to: today,
      grain: "hour",
      segments: ["analytics"],
    });
    expect(res.range).toBe("custom");
    expect(res.analytics).toMatchObject({
      visitors: 1,
      visits: 1,
      views: 1,
      visitorsSpanApps: false,
    });
    expect(res.analytics.timeline).toHaveLength(24);

    const staging = await call(insightsTools.insights_read, {
      project: project.id,
      app: "demo",
      env: "staging",
      segments: ["analytics"],
    });
    expect(staging.analytics.visitors).toBe(2);

    const whole = await call(insightsTools.insights_read, {
      project: project.id,
      segments: ["analytics"],
    });
    expect(whole.analytics.visitors).toBe(3);
    expect(whole.analytics.visitorsSpanApps).toBe(true);
  });

  it("refuses an app that has no copy by that name", async () => {
    const { project, call, insightsTools } = await setup();
    await expect(
      call(insightsTools.insights_read, {
        project: project.id,
        app: "nope",
      }),
    ).rejects.toThrow();
  });

  it("should keep apps apart, where the errors inbox merges them", async () => {
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
        });
        return insightsTools.insights_read.execute({
          project: otherProject.id,
        });
      }),
    ).rejects.toThrow();
  });
});
