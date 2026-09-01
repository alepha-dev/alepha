import { Alepha, z } from "alepha";
import { InvitationService } from "alepha/api/invitations";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { InvitationController } from "../src/api/controllers/InvitationController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ReadCounter } from "./fixtures/ReadCounter.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  projects: ProjectController;
  invitations: InvitationController;
  service: InvitationService;
  counter: ReadCounter;
  fake: FakeProvider;
  /**
   * The inbox as the client sees it.
   *
   * Read through the CONTROLLER rather than the service since the extraction
   * (#1663): `InvitationService` lives in `alepha/api/invitations` now and
   * answers the generic `resourceTitle`, while `projectTitle` and its
   * "Project" fallback are Lore's, applied here. The batched read itself
   * moved to `ProjectInvitationResource.describeAll`, so the query counts
   * below still measure the thing they were written for.
   */
  inbox: (user: {
    id: string;
    roles: string[];
    email: string;
  }) => Promise<Array<{ projectTitle: string; inviterName?: string }>>;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with(ReadCounter);

  await alepha.start();

  const invitations = alepha.inject(InvitationController);

  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    invitations,
    service: alepha.inject(InvitationService),
    counter: alepha.inject(ReadCounter),
    fake: alepha.inject(FakeProvider),
    // `run`, not `fetch`: the inbox is resolved from the caller's EMAIL, and
    // only the direct path hands the token through untouched.
    inbox: (user) => invitations.listMyInvitations.run({}, { user }),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fake.generate(userDataSchema);
  const res = await ctx.admin.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: res.data.id, roles: res.data.roles, email: fakeUser.email };
};

/**
 * The pending-invitation inbox, which used to resolve the project and the
 * inviter one invitation at a time — and sequentially inside each, so five
 * invitations were ten round trips.
 *
 * The enrichment had no coverage at all, which matters more than the count:
 * the "Project" fallback and the undefined inviter name are the two things
 * a batched rewrite silently drops.
 */
describe("the pending-invitation inbox", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const invite = async (
    owner: { id: string; roles: string[] },
    projectId: number,
    email: string,
  ) => {
    const res = await ctx.invitations.createInvitation.fetch(
      {
        body: {
          email,
          resourceType: "project",
          resourceId: String(projectId),
        },
      },
      { user: owner },
    );
    return res.data;
  };

  it("names every project and inviter across the inbox", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const invitee = await createTestUser(ctx);

    const titles = ["Alpha", "Beta", "Gamma"];
    for (const title of titles) {
      const project = await ctx.projects.createProject.fetch(
        { body: { title } },
        { user: owner },
      );
      await invite(owner, project.data.id, invitee.email);
    }

    const inbox = await ctx.inbox(invitee);

    expect(inbox.map((it) => it.projectTitle).sort()).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    // `formatInviterName` takes the local part of the inviter's email, and
    // it has to still be reached through the batched map.
    const expected = owner.email.slice(0, owner.email.indexOf("@"));
    expect(inbox.map((it) => it.inviterName)).toEqual([
      expected,
      expected,
      expected,
    ]);
  });

  it("reads projects and users once each, whatever the inbox holds", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const invitee = await createTestUser(ctx);

    const measure = async (count: number) => {
      for (let i = 0; i < count; i += 1) {
        const project = await ctx.projects.createProject.fetch(
          { body: { title: `P ${crypto.randomUUID().slice(0, 8)}` } },
          { user: owner },
        );
        await invite(owner, project.data.id, invitee.email);
      }
      ctx.counter.reset();
      const inbox = await ctx.inbox(invitee);
      return {
        size: inbox.length,
        projects: ctx.counter.of("projects"),
        users: ctx.counter.of("users"),
      };
    };

    const one = await measure(1);
    const six = await measure(5);

    // One read of each table for one invitation and for six. It used to be
    // two per invitation, so six cost twelve.
    //
    // Exact, never `toBeLessThan`: an upper bound stays green if the
    // enrichment stops resolving anything at all, which is precisely the
    // regression the first case above catches from the other side.
    expect({ one, six }).toEqual({
      one: { size: 1, projects: 1, users: 1 },
      six: { size: 6, projects: 1, users: 1 },
    });
  });

  it("resolves two inviters across an inbox from both of them", async ({
    expect,
  }) => {
    const first = await createTestUser(ctx);
    const second = await createTestUser(ctx);
    const invitee = await createTestUser(ctx);

    for (const owner of [first, first, second]) {
      const project = await ctx.projects.createProject.fetch(
        { body: { title: `P ${crypto.randomUUID().slice(0, 8)}` } },
        { user: owner },
      );
      await invite(owner, project.data.id, invitee.email);
    }

    ctx.counter.reset();
    const inbox = await ctx.inbox(invitee);

    const local = (email: string) => email.slice(0, email.indexOf("@"));
    const tally = new Map<string | undefined, number>();
    for (const it of inbox) {
      tally.set(it.inviterName, (tally.get(it.inviterName) ?? 0) + 1);
    }
    expect(tally).toEqual(
      new Map([
        [local(first.email), 2],
        [local(second.email), 1],
      ]),
    );

    // Three invitations, two distinct inviters, ONE users read — the dedupe
    // is what stops the repeated inviter being fetched twice.
    expect(ctx.counter.of("users")).toBe(1);
  });

  it("falls back to 'Project' when the project is gone", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const invitee = await createTestUser(ctx);
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Doomed" } },
      { user: owner },
    );
    await invite(owner, project.data.id, invitee.email);

    await ctx.projects.deleteProjectById.fetch(
      { params: { id: project.data.id } },
      { user: owner },
    );

    // An id absent from the batched result set has to land on the same
    // fallback the per-row `findOne` gave it. Without it the inbox renders
    // an entry with no name at all.
    const inbox = await ctx.inbox(invitee);
    expect(inbox.map((it) => it.projectTitle)).toEqual(["Project"]);
  });
});
