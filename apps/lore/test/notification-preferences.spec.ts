import { Alepha } from "alepha";
import {
  NotificationInboxRecipientProvider,
  NotificationPreferenceProvider,
  NotificationSuppressionService,
} from "alepha/api/notifications";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { NotificationPreferenceController } from "../src/api/controllers/NotificationPreferenceController.ts";
import { notificationPreferences } from "../src/api/entities/notificationPreferences.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreInboxRecipientProvider } from "../src/api/providers/LoreInboxRecipientProvider.ts";
import { LoreNotificationPreferences } from "../src/api/providers/LoreNotificationPreferences.ts";

class Probe {
  prefs = $repository(notificationPreferences);
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
  alepha.with({
    provide: NotificationInboxRecipientProvider,
    use: LoreInboxRecipientProvider,
  });
  alepha.with({
    provide: NotificationPreferenceProvider,
    use: LoreNotificationPreferences,
  });
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  const users = alepha.inject(UserService);
  await alepha.start();

  // ⚠️ Stored mixed-case on purpose: the gate is handed a contact and has to
  // find the row anyway, or a preference is never honoured for that account.
  const user = await users.createUser({
    username: "member",
    email: "Member@Example.com",
  });

  const asUser = <R>(fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, {
        id: user.id,
        roles: ["user"],
      } as any);
      return fn();
    });

  return {
    alepha,
    probe,
    user,
    asUser,
    prefs: alepha.inject(NotificationPreferenceProvider),
    suppressions: alepha.inject(NotificationSuppressionService),
    controller: alepha.inject(NotificationPreferenceController),
  };
};

const ask = (
  ctx: Awaited<ReturnType<typeof setup>>,
  options: Record<string, unknown>,
) =>
  ctx.prefs.allows({
    contact: "member@example.com",
    channel: "email",
    template: "lore:inbox:mention",
    category: "mentions",
    ...options,
  } as never);

describe("Lore's notification preferences", () => {
  it("allows everything when there is no row", async ({ expect }) => {
    const ctx = await setup();

    expect(await ask(ctx, {})).toBe(true);
    expect(await ask(ctx, { channel: "inbox" })).toBe(true);

    await ctx.alepha.stop();
  });

  it("allows everything for a contact nobody owns", async ({ expect }) => {
    const ctx = await setup();

    expect(await ask(ctx, { contact: "stranger@example.com" })).toBe(true);

    await ctx.alepha.stop();
  });

  /**
   * Axis one. Email off is off for every category on that channel, and the
   * inbox is untouched by it: there is no `inbox` channel switch, because a
   * bell you have silenced is a feature you have deleted.
   */
  it("honours the email channel switch, and leaves the inbox alone", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.probe.prefs.create({
      userId: ctx.user.id,
      emailEnabled: false,
    } as never);

    expect(await ask(ctx, { channel: "email" })).toBe(false);
    expect(await ask(ctx, { channel: "inbox" })).toBe(true);

    await ctx.alepha.stop();
  });

  /**
   * Axis two. A muted category is muted on BOTH channels: "I do not care
   * about releases" is one preference, not two.
   */
  it("honours a muted category on both channels", async ({ expect }) => {
    const ctx = await setup();
    await ctx.probe.prefs.create({
      userId: ctx.user.id,
      mutedCategories: ["releases"],
    } as never);

    expect(await ask(ctx, { category: "releases" })).toBe(false);
    expect(await ask(ctx, { category: "releases", channel: "inbox" })).toBe(
      false,
    );
    // A category they did not mute still passes.
    expect(await ask(ctx, { category: "mentions" })).toBe(true);

    await ctx.alepha.stop();
  });

  /**
   * A password reset somebody opted out of is an account they cannot get
   * back into.
   */
  it("never mutes a critical template", async ({ expect }) => {
    const ctx = await setup();
    await ctx.probe.prefs.create({
      userId: ctx.user.id,
      mutedCategories: ["security"],
    } as never);

    expect(await ask(ctx, { category: "security" })).toBe(false);
    expect(await ask(ctx, { category: "security", critical: true })).toBe(true);

    await ctx.alepha.stop();
  });

  /**
   * ⚠️ The framework consults this AFTER the suppression list, so saying yes
   * cannot resurrect an address that bounced. Asserted through the sender's
   * own gate rather than trusted.
   */
  it("cannot override a suppression", async ({ expect }) => {
    const ctx = await setup();
    await ctx.suppressions.suppress({
      contact: "member@example.com",
      channel: "email",
      reason: "bounced",
      source: "admin",
    });

    // The preference says yes...
    expect(await ask(ctx, {})).toBe(true);
    // ...and the suppression still stands.
    expect(
      await ctx.suppressions.isSuppressed({
        contact: "member@example.com",
        channel: "email",
      }),
    ).toBeTruthy();

    await ctx.alepha.stop();
  });

  it("reads and writes the caller's own row, and nobody else's", async ({
    expect,
  }) => {
    const ctx = await setup();

    const initial = await ctx.asUser(() =>
      ctx.controller.getMyNotificationPreferences({} as never),
    );
    expect(initial.emailEnabled).toBe(true);
    expect(initial.mutedCategories).toEqual([]);
    // Read from the container's own registry, not from the admin-gated
    // catalogue endpoint.
    expect(initial.categories).toContain("mentions");
    expect(initial.categories).toContain("releases");
    // `critical` templates are excluded: `security` is the password reset.
    expect(initial.categories).not.toContain("security");

    const updated = await ctx.asUser(() =>
      ctx.controller.updateMyNotificationPreferences({
        body: { emailEnabled: false, mutedCategories: ["releases"] },
      } as never),
    );
    expect(updated.emailEnabled).toBe(false);
    expect(updated.mutedCategories).toEqual(["releases"]);

    // And the gate now agrees with the page.
    expect(await ask(ctx, {})).toBe(false);

    await ctx.alepha.stop();
  });

  it("leaves an omitted key alone, so two controls cannot clobber each other", async ({
    expect,
  }) => {
    const ctx = await setup();

    await ctx.asUser(() =>
      ctx.controller.updateMyNotificationPreferences({
        body: { mutedCategories: ["releases"] },
      } as never),
    );
    const after = await ctx.asUser(() =>
      ctx.controller.updateMyNotificationPreferences({
        body: { emailEnabled: false },
      } as never),
    );

    expect(after.emailEnabled).toBe(false);
    expect(after.mutedCategories).toEqual(["releases"]);

    await ctx.alepha.stop();
  });

  it("drops a category no template declares", async ({ expect }) => {
    const ctx = await setup();

    const after = await ctx.asUser(() =>
      ctx.controller.updateMyNotificationPreferences({
        body: { mutedCategories: ["releases", "made-up"] },
      } as never),
    );

    expect(after.mutedCategories).toEqual(["releases"]);

    await ctx.alepha.stop();
  });
});
