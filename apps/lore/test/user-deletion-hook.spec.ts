import { Alepha, z } from "alepha";
import {
  AdminUserController,
  AlephaApiUsers,
  MyAccountController,
  RealmProvider,
} from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { UserDeletionHook } from "../src/api/hooks/UserDeletionHook.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * The guard for `UserDeletionHook`.
 *
 * Lore's `projects.createdBy` is a bare `z.uuid()` with **no foreign key**, so
 * deleting an owner cascades nothing and complains about nothing — the project
 * survives pointing at a row that no longer exists, and every `assertOwner` on
 * it fails for everybody from then on. Nothing in the schema, the types or the
 * migration snapshot would catch that; this spec is the only thing that does.
 */
interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  questController: QuestController;
  deletionHook: UserDeletionHook;
  accountController: MyAccountController;
  realmProvider: RealmProvider;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    questController: alepha.inject(QuestController),
    deletionHook: alepha.inject(UserDeletionHook),
    accountController: alepha.inject(MyAccountController),
    realmProvider: alepha.inject(RealmProvider),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return {
    id: response.data.id,
    roles: response.data.roles,
    email: response.data.email as string,
  };
};

const deleteAccount = (
  ctx: TestContext,
  user: { id: string; roles: string[]; email: string },
) =>
  ctx.accountController.deleteMyAccount.fetch(
    // No `currentPassword`: an admin-created account has no credentials
    // identity, so the server takes the confirmation phrase alone.
    { body: { confirm: user.email } },
    { user: user as never },
  );

const accountExists = async (ctx: TestContext, id: string) =>
  Boolean(
    await ctx.realmProvider
      .userRepository()
      .findOne({ where: { id: { eq: id } } }),
  );

/**
 * `.fetch()` goes over HTTP, so a `ConflictError` thrown inside the hook
 * arrives as an `HttpError` carrying its status and message — not as the
 * original class. Asserting on the status is what actually pins "the refusal
 * reached the client as a 409 rather than a generic 500".
 */
const expectConflict = async (promise: Promise<unknown>, message?: string) => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!HttpError.is(error, 409)) {
    throw new Error(`expected a 409, got ${String(error)}`);
  }
  if (message && !(error as HttpError).message.includes(message)) {
    throw new Error(
      `expected the message to include "${message}", got "${(error as HttpError).message}"`,
    );
  }
};

describe("UserDeletionHook", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lets an account with no projects delete itself", async ({ expect }) => {
    const user = await createTestUser(ctx);

    await deleteAccount(ctx, user);

    expect(await accountExists(ctx, user.id)).toBe(false);
  });

  it("refuses while the account still owns a project", async () => {
    const user = await createTestUser(ctx);
    await ctx.projectController.createProject.fetch(
      { body: { title: "Still owned" } },
      { user },
    );

    await expectConflict(deleteAccount(ctx, user));
  });

  it("leaves the account intact when it refuses", async ({ expect }) => {
    // The assertion that matters. Reporting an error after the row is already
    // gone would be worse than not refusing at all.
    const user = await createTestUser(ctx);
    await ctx.projectController.createProject.fetch(
      { body: { title: "Still owned" } },
      { user },
    );

    await expectConflict(deleteAccount(ctx, user));

    expect(await accountExists(ctx, user.id)).toBe(true);
  });

  it("names the count in a message the person can act on", async () => {
    /*
      `MyAccountController` emits without `{ log: true }` precisely so this
      message survives unwrapped — the logging path would bury it inside
      `AlephaError("Failed during '…' hook for service: X")` and collapse the
      status to 500. If that ever regresses, this is what goes red.
    */
    const user = await createTestUser(ctx);
    for (const title of ["One", "Two"]) {
      await ctx.projectController.createProject.fetch({ body: { title } }, {
        user,
      } as never);
    }

    await expectConflict(deleteAccount(ctx, user), "You still own 2 projects");
  });

  it("counts the quests deletion would take with it", async ({ expect }) => {
    /*
      The count the delete dialog states before the click. It exists because
      `quests.createdBy` cascades and the hook deliberately does NOT refuse on
      it — so this number is the only warning a collaborator gets that quests
      they authored inside someone else's project go too.
    */
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Has quests" } },
      { user },
    );
    await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Authored",
          description: "d",
          area: "general",
          priority: "medium",
        },
      } as never,
      { user },
    );

    const { data } = await ctx.deletionHook.countMyAuthoredQuests.fetch(
      {},
      { user },
    );
    expect(data.count).toBe(1);
  });

  it("stops refusing once the projects are deleted", async ({ expect }) => {
    /*
      The refusal has to be actionable: delete your projects, then your
      account. If it survived the delete, the message would name a number the
      UI shows as zero and offer no way to reach it.

      `deleteProjectById` soft-deletes, and `count()` is default-scoped to live
      rows — so the hook counts what the owner can still see, which is the
      right definition. The soft-deleted row keeps a `createdBy` pointing at a
      user that is about to vanish, and that is harmless precisely because
      every read filters it out; nothing can `assertOwner` on a row nothing
      returns.
    */
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Temporary" } },
      { user },
    );

    await expectConflict(deleteAccount(ctx, user));

    await ctx.projectController.deleteProjectById.fetch(
      { params: { id: created.data.id } },
      { user },
    );
    await deleteAccount(ctx, user);

    expect(await accountExists(ctx, user.id)).toBe(false);
  });
});
