import { DashboardMetricRegistry } from "@lore/core/api";
import {
  type DashboardCardValue,
  DashboardMetricCatalog,
  hostJobs,
  hosts,
  type Project,
} from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class JobRepositories {
  hosts = $repository(hosts);
  jobs = $repository(hostJobs);
}

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * The Running jobs card (#Q4342): the agent jobs queued or running, what
 * each row says, and what gates the card (Prompts, `host:read`).
 */
describe("dashboard running jobs card", () => {
  let alepha: Alepha;
  let repos: JobRepositories;
  let dateTime: DateTimeProvider;

  beforeEach(async () => {
    alepha = Alepha.create({ env: { DATABASE_URL: ":memory:" } });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    alepha.inject(TestEntityRepositories);
    repos = alepha.inject(JobRepositories);
    await alepha.start();
    dateTime = alepha.inject(DateTimeProvider);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const resolve = async (project: Project): Promise<DashboardCardValue> =>
    (
      await alepha.inject(DashboardMetricRegistry).resolveForProject(
        [
          {
            id: 1,
            metric: "runningJobs",
            scope: { kind: "projects", projectIds: [project.id] },
            filters: {},
            size: 1,
            position: 0,
          },
        ],
        token(project.createdBy!),
        project,
      )
    )[0]!;

  const withPrompts = () =>
    createTestProject(alepha, {
      capabilities: [{ key: "plan" }, { key: "prompts" }],
    });

  it("is offered in the Add card panel, gated on Prompts and host:read", ({
    expect,
  }) => {
    expect(
      alepha.inject(DashboardMetricCatalog).get("runningJobs"),
    ).toMatchObject({
      boards: ["project"],
      presentation: "list",
      requires: "host:read",
      needs: { capability: "prompts" },
    });
  });

  it("lists the agent jobs in flight, running first, each linking to its job", async ({
    expect,
  }) => {
    const project = await withPrompts();
    const host = await repos.hosts.create({
      projectId: project.id,
      ownerUserId: project.createdBy!,
      type: "bay",
      slug: "nfo1",
    });
    const job = (
      status: "queued" | "running" | "succeeded",
      prompt: string,
      kind: "agent" | "check" = "agent",
    ) =>
      repos.jobs.create({
        projectId: project.id,
        hostId: host.id,
        kind,
        status,
        input: { timeoutSeconds: 600 },
        prompt,
        queuedAt: dateTime.nowISOString(),
        ...(status === "queued" ? {} : { startedAt: dateTime.nowISOString() }),
      });
    const waiting = await job("queued", "triage");
    const running = await job("running", "work-loose-quests");
    await job("succeeded", "review-epic");
    await job("running", "check", "check");

    const value = await resolve(project);

    expect(value).toMatchObject({ ok: true, value: 1 });
    expect(
      (value.rows ?? []).map((row) => [row.id, row.title, row.badge]),
    ).toEqual([
      ["nfo1", "Work on loose quests", "running"],
      ["nfo1", "Triage feedback and errors", "queued"],
    ]);
    expect(value.rows?.[0]?.at).toBe(running.startedAt);
    expect(value.rows?.[1]?.at).toBe(waiting.queuedAt);
    expect(value.rows?.[0]?.link).toEqual({
      route: "projectJob",
      params: { projectSlug: project.slug, jobId: running.id },
    });
    expect(value.link?.route).toBe("projectSettingsPromptJobs");
  });

  it("answers noJobs when nothing is queued or running", async ({ expect }) => {
    const project = await withPrompts();
    expect((await resolve(project)).empty).toBe("noJobs");
  });

  it("is not resolved for a project without Prompts", async ({ expect }) => {
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "plan" }],
    });
    const value = await resolve(project);
    expect(value.rows).toBeUndefined();
    expect(value.empty).toBeDefined();
  });
});
