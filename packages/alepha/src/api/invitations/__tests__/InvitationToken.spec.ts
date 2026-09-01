import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiInvitations,
  $invitationResource,
  type InvitationEntity,
  InvitationRegistrationService,
  InvitationService,
  InvitationTokenService,
} from "../index.ts";

class TestResource {
  public readonly members = new Set<string>();
  public inviterAllowed = true;

  public readonly widget = $invitationResource({
    type: "widget",
    assertCanInvite: () => {
      if (!this.inviterAllowed) {
        throw new ForbiddenError("Not your widget");
      }
    },
    isPrincipal: (_resourceId, principal) =>
      !!principal.userId && this.members.has(principal.userId),
    grant: (userId) => {
      this.members.add(userId);
    },
  });
}

/**
 * The invite link. Everything here is about one question: who does this
 * secret let in, and for how long.
 */
const setup = async () => {
  const alepha = Alepha.create();
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiInvitations);
  alepha.inject(TestResource);

  // The token is handed out exactly once, on the event, because the mail is
  // the application's to write. Capturing it here is what a notification does.
  const minted: string[] = [];
  alepha.events.on("invitation:created", ({ token }) => {
    minted.push(token);
  });

  await alepha.start();

  const service = alepha.inject(InvitationService);

  const invite = async (
    email = "guest@example.com",
  ): Promise<{ invitation: InvitationEntity; token: string }> => {
    const invitation = await service.create(
      { email, resourceType: "widget", resourceId: "7" },
      { id: crypto.randomUUID(), roles: ["user"] } as UserAccountToken,
    );
    return { invitation, token: minted[minted.length - 1] };
  };

  return {
    alepha,
    service,
    invite,
    minted,
    tokens: alepha.inject(InvitationTokenService),
    guard: alepha.inject(InvitationRegistrationService),
    dateTime: alepha.inject(DateTimeProvider),
  };
};

describe("alepha/api/invitations - the signup token", () => {
  it("is minted with every invitation and resolves back to it", async ({
    expect,
  }) => {
    const { invite, tokens } = await setup();
    const { invitation, token } = await invite();

    expect(token).toBeTruthy();
    expect(token).not.toBe(invitation.id);

    const resolved = await tokens.resolve(token);
    expect(resolved?.id).toBe(invitation.id);
  });

  it("refuses a wrong secret, a malformed token and nothing at all", async ({
    expect,
  }) => {
    const { invite, tokens } = await setup();
    const { invitation } = await invite();

    expect(await tokens.resolve(undefined)).toBeUndefined();
    expect(await tokens.resolve("")).toBeUndefined();
    expect(await tokens.resolve("not-a-token")).toBeUndefined();
    expect(await tokens.resolve(`${invitation.id}.`)).toBeUndefined();
    expect(
      await tokens.resolve(`${invitation.id}.${crypto.randomUUID()}`),
    ).toBeUndefined();
    expect(
      await tokens.resolve(`${crypto.randomUUID()}.whatever`),
    ).toBeUndefined();
  });

  it("dies when the invitation is revoked", async ({ expect }) => {
    const { invite, tokens, service } = await setup();
    const { invitation, token } = await invite();

    await service.revoke(invitation.id, { id: crypto.randomUUID() });

    expect(await tokens.resolve(token)).toBeUndefined();
  });

  it("dies when the invitation is declined", async ({ expect }) => {
    const { invite, tokens, service } = await setup();
    const { invitation, token } = await invite();

    await service.decline(invitation.id, {
      id: crypto.randomUUID(),
      email: "guest@example.com",
    });

    expect(await tokens.resolve(token)).toBeUndefined();
  });

  /**
   * This is what "single use" means here, and it is stronger than a token
   * that burns on first read: the invitation is the thing that can only be
   * spent once, so nothing has to remember to revoke the secret separately.
   * A registration attempt that fails on the captcha does not cost the
   * recipient their link.
   */
  it("dies when the invitation is accepted", async ({ expect }) => {
    const { invite, tokens, service } = await setup();
    const { invitation, token } = await invite();

    await service.accept(invitation.id, {
      id: crypto.randomUUID(),
      email: "guest@example.com",
    });

    expect(await tokens.resolve(token)).toBeUndefined();
  });

  /**
   * The reason `VerificationEntry` grew an `expiresAt`: a `link` verification
   * expires after 30 minutes by default and is capped at two hours, so
   * without it this token would be dead long before the seven-day invitation
   * it belongs to, and dead on arrival for anyone who reads mail in the
   * evening.
   */
  it("outlives the two-hour link default, and dies with the invitation", async ({
    expect,
  }) => {
    const { invite, tokens, dateTime } = await setup();
    const { token } = await invite();

    await dateTime.travel([3, "hours"]);
    expect(await tokens.resolve(token)).toBeDefined();

    await dateTime.travel([2, "days"]);
    expect(await tokens.resolve(token)).toBeDefined();

    // Past the invitation's own seven days.
    await dateTime.travel([6, "days"]);
    expect(await tokens.resolve(token)).toBeUndefined();
  });

  describe("as the realm's pre-authorization seam", () => {
    it("lets the invited address register, and says the address is proven", async ({
      expect,
    }) => {
      const { invite, guard } = await setup();
      const { token } = await invite();

      expect(
        await guard.preAuthorize({
          email: "guest@example.com",
          method: "credentials",
          token,
        }),
      ).toEqual({ emailVerified: true });
    });

    it("refuses the same token presented for a different address", async ({
      expect,
    }) => {
      const { invite, guard } = await setup();
      const { token } = await invite();

      expect(
        await guard.preAuthorize({
          email: "someone-else@example.com",
          method: "credentials",
          token,
        }),
      ).toBe(false);
    });

    it("refuses a credentials registration carrying no token", async ({
      expect,
    }) => {
      const { invite, guard } = await setup();
      await invite();

      expect(
        await guard.preAuthorize({
          email: "guest@example.com",
          method: "credentials",
        }),
      ).toBe(false);
    });

    it("accepts an OAuth first login on a pending invitation alone", async ({
      expect,
    }) => {
      const { invite, guard } = await setup();
      await invite();

      // No token survives the provider round trip; the provider's own
      // assertion is what stands in for it.
      expect(
        await guard.preAuthorize({
          email: "guest@example.com",
          method: "oauth",
          provider: "google",
          emailVerified: true,
        }),
      ).toEqual({ emailVerified: false });
    });

    it("refuses OAuth when the provider did not verify the address", async ({
      expect,
    }) => {
      const { invite, guard } = await setup();
      await invite();

      for (const emailVerified of [false, undefined]) {
        expect(
          await guard.preAuthorize({
            email: "guest@example.com",
            method: "oauth",
            provider: "google",
            emailVerified,
          }),
        ).toBe(false);
      }
    });

    it("refuses OAuth for an address nobody invited", async ({ expect }) => {
      const { invite, guard } = await setup();
      await invite();

      expect(
        await guard.preAuthorize({
          email: "stranger@example.com",
          method: "oauth",
          provider: "google",
          emailVerified: true,
        }),
      ).toBe(false);
    });

    it("refuses OAuth once the invitation is gone", async ({ expect }) => {
      const { invite, guard, service } = await setup();
      const { invitation } = await invite();
      await service.revoke(invitation.id, { id: crypto.randomUUID() });

      expect(
        await guard.preAuthorize({
          email: "guest@example.com",
          method: "oauth",
          provider: "google",
          emailVerified: true,
        }),
      ).toBe(false);
    });
  });

  it("mints nothing when the resolver refuses the inviter", async ({
    expect,
  }) => {
    const { alepha, invite, minted } = await setup();
    // The authorization gate runs before anything else in `create`, so a
    // caller with no business inviting cannot make the system mail a secret
    // to an address of their choosing.
    alepha.inject(TestResource).inviterAllowed = false;

    await expect(invite("victim@example.com")).rejects.toThrowError(
      ForbiddenError,
    );
    expect(minted).toHaveLength(0);
  });
});
