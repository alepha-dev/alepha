import {
  LiveQuestRegistry,
  ProjectCapabilityController,
  ProjectController,
} from "@lore/core/api";
import { QuestController } from "@lore/plan/api";
import { quests } from "@lore/plan/schemas";
import { ArtifactController, CommitQuestSetService } from "@lore/ship/api";
import { packedArtifact } from "@lore/ship/testing";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

class QuestRows {
  public readonly quests = $repository(quests);
}

/**
 * Live quests across the Plan-Ship seam (#E154): Plan registers each quest's
 * recorded commits on the core registry, and a push that walked one of them
 * keeps that quest in its commit's set, with neither module importing the
 * other.
 */
describe("live quests across Plan and Ship", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    bootLore(alepha);
    alepha.with(QuestRows);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("matches a quest by the sha recorded on it, abbreviated, when the push walked that commit", async ({
    expect,
  }) => {
    const created = await alepha.inject(AdminUserController).createUser.fetch(
      {
        body: {
          ...alepha.inject(FakeProvider).generate(userDataSchema),
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    const user = { id: created.data.id, roles: created.data.roles };
    const project = (
      await alepha.inject(ProjectController).createProject.fetch(
        {
          body: {
            title: `Seam ${crypto.randomUUID().slice(0, 8)}`,
            capabilities: [{ key: "plan" as const }],
          },
        },
        { user },
      )
    ).data;
    await alepha.inject(ProjectCapabilityController).setCapability.fetch(
      {
        params: { projectId: project.id, key: "ship" },
        body: { enabled: true },
      },
      { user },
    );
    const quest = (
      await alepha.inject(QuestController).createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "Rebased away",
            description: "",
            area: "api",
            priority: "medium",
            objectives: [],
            attachments: [],
          },
        },
        { user },
      )
    ).data;
    const walked = "ab12cd34".padEnd(40, "0");
    await alepha.inject(QuestRows).quests.updateById(quest.id, {
      commits: [
        {
          sha: walked.slice(0, 10),
          at: "2026-11-01T00:00:00.000Z",
          by: user.id,
        },
      ],
      completedAt: "2026-11-01T00:00:00.000Z",
    } as never);

    expect(
      await alepha.inject(LiveQuestRegistry).recordedCommits(project.id),
    ).toEqual([
      {
        number: quest.shortId,
        shas: [walked.slice(0, 10)],
        completed: true,
        completedAt: "2026-11-01T00:00:00.000Z",
      },
    ]);

    const head = "f".repeat(40);
    const pushed = await alepha.inject(ArtifactController).pushArtifact.fetch(
      {
        params: { projectId: project.id },
        body: {
          app: "my-app",
          tag: "latest",
          commitSha: head,
          file: await packedArtifact(),
          quests: { version: 1, numbers: [], complete: true },
          commits: new File([JSON.stringify([head, walked])], "commits.json"),
        },
      },
      { user },
    );

    expect(pushed.data.quests).toEqual({ count: 1, complete: true });
    const set = (
      await alepha.inject(CommitQuestSetService).setsOf(project.id, [head])
    ).get(head);
    expect([...(set?.numbers ?? [])]).toEqual([quest.shortId]);
  });
});
