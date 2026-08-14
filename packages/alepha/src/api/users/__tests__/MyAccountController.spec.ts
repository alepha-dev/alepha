import { $hook, Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { BadRequestError, ConflictError } from "alepha/server";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  MyAccountController,
  RealmProvider,
} from "../index.ts";

const PASSWORD = "correct-horse-battery";

/**
 * Refuses deletion the way a real application would — Lore's own hook is this
 * shape, counting owned projects.
 */
class RefusingHook {
  onUserDelete = $hook({
    on: "user:delete:before",
    handler: async () => {
      throw new ConflictError("You still own 3 projects");
    },
  });
}

/**
 * The other half of the seam: cleanup that succeeds and lets deletion through.
 */
class CleanupHook {
  public ran: string[] = [];

  onUserDelete = $hook({
    on: "user:delete:before",
    handler: async ({ userId }) => {
      this.ran.push(userId);
    },
  });
}

const setup = async (options: { hook?: any; withPassword?: boolean } = {}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  if (options.hook) {
    alepha.with(options.hook);
  }
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  const crypto = alepha.inject(CryptoProvider);
  await realmProvider.userRepository().deleteMany({});

  const user = await realmProvider.userRepository().create({
    username: `del-${crypto.randomUUID().slice(0, 8)}`,
    email: `del-${crypto.randomUUID().slice(0, 8)}@example.com`,
  });

  if (options.withPassword !== false) {
    await realmProvider.identityRepository().create({
      provider: "credentials",
      userId: user.id,
      password: await crypto.hashPassword(PASSWORD),
    });
  }

  return {
    alepha,
    controller: alepha.inject(MyAccountController),
    realmProvider,
    user,
    caller: { id: user.id, realm: "default", sessionId: "s-1" },
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const remove = (ctx: Ctx, body: Record<string, unknown>) =>
  ctx.controller.deleteMyAccount({ body } as never, {
    user: ctx.caller as never,
  });

const stillExists = async (ctx: Ctx) =>
  Boolean(
    await ctx.realmProvider
      .userRepository()
      .findOne({ where: { id: { eq: ctx.user.id } } }),
  );

describe("alepha/api/users - MyAccountController", () => {
  it("should delete the account with the right password and confirmation", async ({
    expect,
  }) => {
    const ctx = await setup();

    await remove(ctx, {
      currentPassword: PASSWORD,
      confirm: ctx.user.email,
    });

    expect(await stillExists(ctx)).toBe(false);
  });

  it("should refuse a wrong current password and keep the account", async ({
    expect,
  }) => {
    // Stops someone who walked up to an unlocked, signed-in laptop.
    const ctx = await setup();

    await expect(
      remove(ctx, { currentPassword: "not-mine", confirm: ctx.user.email }),
    ).rejects.toThrowError(BadRequestError);

    expect(await stillExists(ctx)).toBe(true);
  });

  it("should refuse a missing password on a password account", async ({
    expect,
  }) => {
    const ctx = await setup();

    await expect(remove(ctx, { confirm: ctx.user.email })).rejects.toThrowError(
      BadRequestError,
    );

    expect(await stillExists(ctx)).toBe(true);
  });

  it("should refuse a wrong confirmation phrase and keep the account", async ({
    expect,
  }) => {
    // The second, independent proof: not "is it you" but "did you mean it".
    const ctx = await setup();

    await expect(
      remove(ctx, { currentPassword: PASSWORD, confirm: "yes" }),
    ).rejects.toThrowError(BadRequestError);

    expect(await stillExists(ctx)).toBe(true);
  });

  it("should let an OAuth-only account delete with the confirmation alone", async ({
    expect,
  }) => {
    // There is no password to prove knowledge of. Demanding one would make
    // deletion impossible for exactly these accounts.
    const ctx = await setup({ withPassword: false });

    await remove(ctx, { confirm: ctx.user.email });

    expect(await stillExists(ctx)).toBe(false);
  });

  it("should abort deletion when a user:delete:before handler throws", async ({
    expect,
  }) => {
    const ctx = await setup({ hook: RefusingHook });

    await expect(
      remove(ctx, { currentPassword: PASSWORD, confirm: ctx.user.email }),
    ).rejects.toThrowError(ConflictError);

    // The assertion that matters: refusing must actually refuse, not merely
    // report an error after the row is gone.
    expect(await stillExists(ctx)).toBe(true);
  });

  it("should deliver the handler's own error unwrapped", async ({ expect }) => {
    /*
      `EventManager.emit()`'s fast path rethrows untouched; the `{ log: true }`
      path wraps in `AlephaError("Failed during '…' hook for service: X")`.
      This pins that the emit stays on the fast path — otherwise the only
      sentence the person needed to read gets buried behind a
      framework-internal one, and the status collapses to 500.
    */
    const ctx = await setup({ hook: RefusingHook });

    await expect(
      remove(ctx, { currentPassword: PASSWORD, confirm: ctx.user.email }),
    ).rejects.toThrowError("You still own 3 projects");
  });

  it("should run a passing handler and then delete", async ({ expect }) => {
    const ctx = await setup({ hook: CleanupHook });

    await remove(ctx, {
      currentPassword: PASSWORD,
      confirm: ctx.user.email,
    });

    expect(ctx.alepha.inject(CleanupHook).ran).toEqual([ctx.user.id]);
    expect(await stillExists(ctx)).toBe(false);
  });

  it("should not run the hook when re-authentication fails", async ({
    expect,
  }) => {
    // Cleanup that runs before the caller has proven who they are would let
    // an unauthenticated attempt trigger an application's side effects.
    const ctx = await setup({ hook: CleanupHook });

    await expect(
      remove(ctx, { currentPassword: "not-mine", confirm: ctx.user.email }),
    ).rejects.toThrowError(BadRequestError);

    expect(ctx.alepha.inject(CleanupHook).ran).toEqual([]);
  });

  it("should remove the account's identities with it", async ({ expect }) => {
    const ctx = await setup();

    await remove(ctx, {
      currentPassword: PASSWORD,
      confirm: ctx.user.email,
    });

    const identities = await ctx.realmProvider
      .identityRepository()
      .findMany({ where: { userId: { eq: ctx.user.id } } });
    expect(identities).toHaveLength(0);
  });
});
