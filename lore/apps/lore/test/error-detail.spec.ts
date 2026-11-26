import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { ProjectErrorController } from "@lore/ship/api";
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
    projectId: project.id,
    errorId: filed.id,
    errors: alepha.inject(ProjectErrorController),
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
