import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { QuestController } from "@lore/plan/api";
import {
  ProjectErrorController,
  ProjectErrorThreadController,
} from "@lore/ship/api";
import { projectErrors } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class Probe {
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
  bootLore(alepha, ["api"]);
  const probe = alepha.inject(Probe);
  const users = alepha.inject(UserService);
  alepha.inject(TestEntityRepositories);
  await alepha.start();

  const created = await users.createUser({ username: "owner" });
  const owner: UserAccountToken = { id: created.id, roles: ["user"] };
  const project = await alepha.inject(ProjectController).createProject.run(
    {
      body: {
        title: "Acme",
        capabilities: [
          { key: "plan" },
          { key: "ship", options: { track: true } },
        ],
      },
    },
    { user: owner },
  );
  const filed = await probe.projectErrors.create({
    projectId: project.id,
    fingerprint: "fp-1",
    name: "TypeError",
    message: "Cannot read properties of undefined",
    stack: "TypeError\n    at cart (app.js:1:1)",
    sourceUrl: "https://acme.example/cart",
    origin: "server",
    count: 7,
    firstSeenAt: "2026-08-01T10:00:00.000Z",
    lastSeenAt: "2026-08-01T10:05:00.000Z",
  });
  return {
    alepha,
    owner,
    project,
    projectId: project.id,
    errorId: filed.id,
    errors: alepha.inject(ProjectErrorController),
    thread: alepha.inject(ProjectErrorThreadController),
    quests: alepha.inject(QuestController),
    capabilities: alepha.inject(ProjectCapabilityController),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const read = (w: World) =>
  w.errors.getProjectError.run(
    { params: { projectId: w.projectId, errorId: w.errorId } },
    { user: w.owner },
  );

/**
 * The quest block of one error's read (#E185), with Plan registered: the
 * quest comes through the `quest` kind of the resources registry, and goes
 * when Plan is off. The other blocks are `@lore/ship`'s own spec.
 */
describe("getProjectError and the quest an error was forwarded to", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("names the quest with its number, title and status, and nothing before the forward", async ({
    expect,
  }) => {
    expect((await read(w)).quest).toBeUndefined();

    const forwarded = await w.errors.forwardProjectErrorToQuest.run(
      {
        params: { projectId: w.projectId, errorId: w.errorId },
        body: {},
      },
      { user: w.owner },
    );
    const detail = await read(w);

    expect(detail.error.status).toBe(`quest:${forwarded.questId}`);
    expect(detail.quest).toEqual({
      id: forwarded.questId,
      shortId: forwarded.questShortId,
      title: "[Error] TypeError: Cannot read properties of undefined",
      status: "todo",
    });
    // Forwarded is not open: no neighbour.
    expect(detail.previousId).toBeUndefined();
    expect(detail.nextId).toBeUndefined();
  });

  it("leaves the quest out once Plan is off, and keeps the rest of the read", async ({
    expect,
  }) => {
    const forwarded = await w.errors.forwardProjectErrorToQuest.run(
      {
        params: { projectId: w.projectId, errorId: w.errorId },
        body: {},
      },
      { user: w.owner },
    );
    await w.capabilities.setCapability.run(
      {
        params: { projectId: w.projectId, key: "plan" },
        body: { enabled: false },
      },
      { user: w.owner },
    );

    const detail = await read(w);

    expect(detail.quest).toBeUndefined();
    expect(detail.error.status).toBe(`quest:${forwarded.questId}`);
    expect(detail.kind).toBe("sigil");
  });
});

/**
 * The lines a forward, a link and a hand back leave on an error's thread
 * (#E185): the three events that need a quest, so Plan booted.
 */
describe("an error's thread and its quest", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  const at = () => ({
    params: { projectId: w.projectId, errorId: w.errorId },
  });
  const entries = async () =>
    (await w.thread.listProjectErrorThread.run(at(), { user: w.owner }))
      .entries;

  it("records a forward to a new quest, then the hand back when that quest is deleted", async ({
    expect,
  }) => {
    const forwarded = await w.errors.forwardProjectErrorToQuest.run(
      { ...at(), body: {} },
      { user: w.owner },
    );
    expect(await entries()).toMatchObject([
      {
        type: "event",
        kind: "forwarded",
        userId: w.owner.id,
        quest: {
          id: forwarded.questId,
          shortId: forwarded.questShortId,
          title: "[Error] TypeError: Cannot read properties of undefined",
        },
      },
    ]);

    await w.quests.deleteQuest.run(
      { params: { id: forwarded.questId } },
      { user: w.owner },
    );
    const after = await entries();

    expect((await read(w)).error.status).toBe("open");
    expect(after.map((entry) => entry.kind)).toEqual([
      "forwarded",
      "handed_back",
    ]);
    // Lore did it: no member behind the line. The quest is gone, so only
    // its id is left on both.
    expect(after[1]?.userId).toBeUndefined();
    expect(after.map((entry) => entry.quest)).toEqual([
      { id: forwarded.questId },
      { id: forwarded.questId },
    ]);
  });

  it("records a link to a quest already filed, and hides the quest once Plan is off", async ({
    expect,
  }) => {
    const quest = await createTestQuest(w.alepha, w.project, {
      title: "Cart crashes on an empty basket",
    });

    await w.errors.forwardProjectErrorToQuest.run(
      { ...at(), body: { questShortId: quest.shortId } },
      { user: w.owner },
    );

    expect(await entries()).toMatchObject([
      {
        kind: "linked",
        userId: w.owner.id,
        quest: {
          id: quest.id,
          shortId: quest.shortId,
          title: "Cart crashes on an empty basket",
        },
      },
    ]);

    await w.capabilities.setCapability.run(
      {
        params: { projectId: w.projectId, key: "plan" },
        body: { enabled: false },
      },
      { user: w.owner },
    );
    expect((await entries()).map((entry) => entry.quest)).toEqual([
      { id: quest.id },
    ]);
  });

  it("writes one line when a forward is refused the second time, not two", async ({
    expect,
  }) => {
    await w.errors.forwardProjectErrorToQuest.run(
      { ...at(), body: {} },
      { user: w.owner },
    );
    await expect(
      w.errors.forwardProjectErrorToQuest.run(
        { ...at(), body: {} },
        { user: w.owner },
      ),
    ).rejects.toThrow("already forwarded");

    expect((await entries()).map((entry) => entry.kind)).toEqual(["forwarded"]);
  });
});
