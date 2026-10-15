import { DashboardMetricRegistry } from "@lore/core/api";
import type { DashboardCardValue, Project } from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import { blights } from "@lore/deploy/schemas";
import { feedback } from "@lore/work/schemas";
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
  createTestEpic,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class NeedsYouRepositories {
  blights = $repository(blights);
  feedback = $repository(feedback);
}

/**
 * "Needs you" (#E77, #Q2656): one list each module contributes to, gated
 * per source by that source's capability, merged by weight, hidden at zero.
 */
describe("dashboard needs you", () => {
  let alepha: Alepha;
  let repos: NeedsYouRepositories;
  let dateTime: DateTimeProvider;
  let seq = 0;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    alepha.with(ReadCounter);
    alepha.inject(TestEntityRepositories);
    repos = alepha.inject(NeedsYouRepositories);
    await alepha.start();
    dateTime = alepha.inject(DateTimeProvider);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const projectOf = async (
    shape?: Parameters<typeof createTestProject>[1],
  ): Promise<{ project: Project; user: UserAccountToken }> => {
    const project = await createTestProject(alepha, shape);
    await createTestMember(alepha, project, project.createdBy!);
    return { project, user: { id: project.createdBy!, roles: ["user"] } };
  };

  const resolve = async (
    project: Project,
    user: UserAccountToken,
  ): Promise<DashboardCardValue> =>
    (
      await alepha.inject(DashboardMetricRegistry).resolveForProject(
        [
          {
            id: 1,
            metric: "needsYou",
            scope: { kind: "projects", projectIds: [project.id] },
            filters: {},
            size: 1,
            position: 0,
          },
        ],
        user,
        project,
      )
    )[0]!;

  const blight = async (project: Project, name: string) => {
    seq += 1;
    const stamp = dateTime.nowISOString();
    return repos.blights.create({
      projectId: project.id,
      fingerprint: `fp-${seq}`,
      name,
      message: "boom",
      firstSeenAt: stamp,
      lastSeenAt: stamp,
      count: 3,
      status: "open",
    });
  };

  const pending = async (project: Project, title: string) => {
    seq += 1;
    return repos.feedback.create({
      projectId: project.id,
      shortId: seq,
      title,
      description: "",
      status: "pending",
    });
  };

  it("merges every source by weight: overdue, crash, hold, feedback", async ({
    expect,
  }) => {
    const { project, user } = await projectOf();
    await createTestQuest(alepha, project, {
      title: "parked",
      heldAt: dateTime.nowISOString(),
    });
    await createTestQuest(alepha, project, {
      title: "late",
      dueAt: dateTime.now().subtract(2, "day").toISOString(),
    });
    await blight(project, "TypeError");
    await pending(project, "Login is slow");

    const value = await resolve(project, user);

    expect(value.rows?.map((row) => [row.title, row.badge])).toEqual([
      ["late", "overdue"],
      ["TypeError", "blight"],
      ["parked", "held"],
      ["Login is slow", "untriaged"],
    ]);
    expect(value.value).toBe(4);
  });

  it("never flags a plain open quest, even beside a draft epic", async ({
    expect,
  }) => {
    const { project, user } = await projectOf();
    // A draft epic makes the backlog gate write its own `or`.
    await createTestEpic(alepha, project, { status: "draft" });
    await createTestQuest(alepha, project, { title: "plain" });
    await createTestQuest(alepha, project, {
      title: "parked",
      heldAt: dateTime.nowISOString(),
    });

    const value = await resolve(project, user);

    expect(value.rows?.map((row) => row.title)).toEqual(["parked"]);
  });

  it("asks no source whose capability the project lacks", async ({
    expect,
  }) => {
    const { project, user } = await projectOf({
      capabilities: [{ key: "work" }],
    });
    await blight(project, "TypeError");
    await pending(project, "ignored");
    await createTestQuest(alepha, project, {
      title: "parked",
      heldAt: dateTime.nowISOString(),
    });

    const value = await resolve(project, user);

    expect(value.rows?.map((row) => row.badge)).toEqual(["held"]);
  });

  it("is empty at zero, and so absent from the computed board", async ({
    expect,
  }) => {
    const { project, user } = await projectOf();

    expect((await resolve(project, user)).empty).toBe("noData");
  });

  it("caps the list at eight and says how many more each source has", async ({
    expect,
  }) => {
    const { project, user } = await projectOf();
    for (let i = 0; i < 10; i += 1) await blight(project, `Error ${i}`);

    const value = await resolve(project, user);
    const more = value.rows?.filter((row) => row.badge === "more") ?? [];

    expect(value.rows?.filter((row) => row.badge === "blight")).toHaveLength(8);
    expect(more).toEqual([
      expect.objectContaining({ title: "blights", value: 2 }),
    ]);
  });
});
