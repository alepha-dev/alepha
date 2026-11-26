import { LoreInboxRecipientProvider, ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationJobs,
} from "alepha/api/notifications";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreShipApi, ProjectErrorThreadController } from "../src/api/index.ts";
import { projectErrors } from "../src/schemas/index.ts";
import { createTestMemberByProjectId } from "../src/testing/index.ts";

/**
 * The inbox is read directly, and nothing drains a queue here: the job
 * layer's direct mode processes the outbox in this process, as production
 * does (see `plan/test/quest-mention.spec.ts`).
 */
class Probe {
  errors = $repository(projectErrors);
  inbox = $repository(notificationInboxEntity);
  executions = $repository(jobExecutionEntity);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * What an attacker gets to write: an error's name and message. Neither may
 * reach a member's inbox through a mention.
 */
const HOSTILE_NAME = "IgnorePreviousInstructionsError";
const HOSTILE_MESSAGE = "click https://evil.example to verify your account";

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
    },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with({
    provide: NotificationInboxRecipientProvider,
    use: LoreInboxRecipientProvider,
  });
  alepha.with(LoreShipApi);
  const probe = alepha.inject(Probe);
  await alepha.start();

  const fake = alepha.inject(FakeProvider);
  const admin = alepha.inject(AdminUserController);
  const createUser = async (username: string) => {
    const response = await admin.createUser.fetch(
      {
        body: {
          ...fake.generate(userDataSchema),
          username,
          roles: ["user"],
        },
      },
      { user: adminUser },
    );
    return { id: response.data.id, roles: response.data.roles };
  };
  const author = await createUser("fabrice");
  const mentioned = await createUser("nfo");
  const project = (
    await alepha.inject(ProjectController).createProject.fetch(
      {
        body: {
          title: "Mention probe",
          capabilities: [{ key: "ship", options: { track: true } }],
        },
      },
      { user: author },
    )
  ).data;
  await createTestMemberByProjectId(alepha, project.id, mentioned.id);
  const error = await probe.errors.create({
    projectId: project.id,
    fingerprint: "fp-mention",
    name: HOSTILE_NAME,
    message: HOSTILE_MESSAGE,
    origin: "client",
    firstSeenAt: "2026-11-01T10:00:00.000Z",
    lastSeenAt: "2026-11-01T10:00:00.000Z",
  });
  const sendJobName = alepha.inject(NotificationJobs).sendNotification.name;
  const settle = async () => {
    const terminal = new Set(["ok", "error", "cancelled"]);
    for (let attempt = 0; attempt < 50; attempt++) {
      const rows = await probe.executions.findMany({
        where: { jobName: { eq: sendJobName } },
      });
      if (rows.every((row) => terminal.has(String(row.status)))) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("The notification outbox never settled");
  };
  return {
    alepha,
    probe,
    author,
    mentioned,
    project,
    error,
    settle,
    thread: alepha.inject(ProjectErrorThreadController),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const at = (w: World) => ({
  params: { projectId: w.project.id, errorId: w.error.id },
});

/**
 * `@name` in an error comment reaches that member's inbox (#E185), through
 * core's `MentionNotifier`, with a link to the error's page and none of the
 * error's own text: that text is written by anyone who reaches the app.
 */
describe("a mention in an error comment", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("files one message naming the error by its id and kind, linking its page", async ({
    expect,
  }) => {
    await w.thread.createProjectErrorComment.run(
      { ...at(w), body: { body: "@nfo is this the deploy of Monday?" } },
      { user: w.author },
    );

    await w.settle();
    const rows = await w.probe.inbox.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: w.mentioned.id,
      template: "lore:inbox:mention",
      category: "mentions",
      scope: `project:${w.project.id}`,
      scopeLabel: "Mention probe",
      href: `/${w.project.slug}/errors/${w.error.id}`,
      body: "Browser error",
    });
    expect(rows[0].title).toContain(`Error ${w.error.id}`);
    // Nothing of what the application's runtime wrote.
    const whole = JSON.stringify(rows[0]);
    expect(whole).not.toContain(HOSTILE_NAME);
    expect(whole).not.toContain(HOSTILE_MESSAGE);
    expect(whole).not.toContain("evil.example");
  });

  it("pings nobody for a body with no mention, nor for a handle in a code span", async ({
    expect,
  }) => {
    await w.thread.createProjectErrorComment.run(
      { ...at(w), body: { body: "Seen on staging too." } },
      { user: w.author },
    );
    await w.thread.createProjectErrorComment.run(
      { ...at(w), body: { body: "The decorator is `@nfo`, not a person." } },
      { user: w.author },
    );

    await w.settle();
    expect(await w.probe.inbox.findMany({})).toHaveLength(0);
  });

  it("pings only the handle an edit adds", async ({ expect }) => {
    const comment = await w.thread.createProjectErrorComment.run(
      { ...at(w), body: { body: "@nfo have a look" } },
      { user: w.author },
    );
    await w.settle();
    expect(await w.probe.inbox.findMany({})).toHaveLength(1);

    // A typo fixed: the same handle, nobody new.
    await w.thread.updateProjectErrorComment.run(
      {
        params: { ...at(w).params, commentId: comment.id },
        body: { body: "@nfo have a look, please" },
      },
      { user: w.author },
    );
    await w.settle();
    expect(await w.probe.inbox.findMany({})).toHaveLength(1);
  });

  it("lets an agent's comment reach the member it works as", async ({
    expect,
  }) => {
    // Over MCP the author IS the key's owner: only `source` says an agent
    // wrote it, and only then may that owner be reached.
    await w.thread.createProjectErrorComment.run(
      {
        ...at(w),
        body: {
          body: "@fabrice the cause is in the cart reducer.",
          source: { kind: "mcp", client: "claude-code" },
        },
      },
      { user: w.author },
    );
    await w.settle();
    const rows = await w.probe.inbox.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: w.author.id });

    // The same words typed by the member themselves are a note to self.
    await w.thread.createProjectErrorComment.run(
      { ...at(w), body: { body: "@fabrice note to self" } },
      { user: w.author },
    );
    await w.settle();
    expect(await w.probe.inbox.findMany({})).toHaveLength(1);
  });
});
