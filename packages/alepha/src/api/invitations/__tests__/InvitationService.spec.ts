import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiInvitations,
  $invitationResource,
  type InvitationEntity,
  InvitationService,
} from "../index.ts";

/**
 * A resource that records what the module asked it, so the seam can be
 * asserted from the outside: which questions are asked, in what order, and
 * with what.
 *
 * Deliberately not a project: the point of the extraction is that the module
 * has no idea what it is inviting people to.
 */
class TestResource {
  public readonly principals = new Map<string, Set<string>>();
  public readonly grants: Array<{ userId: string; roles?: string[] }> = [];
  public readonly asked: string[] = [];
  public seats = 10;
  public inviterAllowed = true;
  public readonly emails = new Map<string, string>();

  public readonly widget = $invitationResource({
    type: "widget",
    assertCanInvite: (resourceId) => {
      this.asked.push(`assertCanInvite:${resourceId}`);
      if (!this.inviterAllowed) {
        throw new ForbiddenError("Not your widget");
      }
    },
    assertRoom: (resourceId) => {
      this.asked.push(`assertRoom:${resourceId}`);
      if ((this.principals.get(resourceId)?.size ?? 0) >= this.seats) {
        throw new ForbiddenError("Full");
      }
    },
    isPrincipal: (resourceId, principal) => {
      this.asked.push(`isPrincipal:${resourceId}:${principal.email}`);
      const userId = principal.userId ?? this.emails.get(principal.email);
      if (!userId) {
        return false;
      }
      return this.principals.get(resourceId)?.has(userId) === true;
    },
    grant: (userId, invitation) => {
      this.asked.push(`grant:${invitation.resourceId}:${userId}`);
      this.grants.push({ userId, roles: invitation.roles });
      const set =
        this.principals.get(invitation.resourceId) ?? new Set<string>();
      set.add(userId);
      this.principals.set(invitation.resourceId, set);
    },
    describe: (invitation: InvitationEntity) => ({
      resourceTitle: `Widget ${invitation.resourceId}`,
      inviterName: "Someone",
    }),
  });
}

const setup = async () => {
  const alepha = Alepha.create();
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiInvitations);
  const resource = alepha.inject(TestResource);
  await alepha.start();

  return {
    alepha,
    resource,
    service: alepha.inject(InvitationService),
    dateTime: alepha.inject(DateTimeProvider),
  };
};

const owner = (): UserAccountToken => ({
  id: crypto.randomUUID(),
  roles: ["user"],
  email: "owner@example.com",
});

describe("alepha/api/invitations - InvitationService", () => {
  it("routes every resource question through the registered resolver", async ({
    expect,
  }) => {
    const { service, resource } = await setup();
    const inviter = owner();

    const invitation = await service.create(
      { email: "Guest@Example.com", resourceType: "widget", resourceId: "7" },
      inviter,
    );

    // Lowercased on the way in: every later comparison is done on this value.
    expect(invitation.email).toBe("guest@example.com");
    expect(invitation.status).toBe("pending");
    expect(resource.asked).toEqual([
      "assertCanInvite:7",
      "isPrincipal:7:guest@example.com",
      "assertRoom:7",
    ]);
  });

  it("refuses a resourceType nobody registered", async ({ expect }) => {
    const { service } = await setup();

    await expect(
      service.create(
        { email: "guest@example.com", resourceType: "gizmo", resourceId: "1" },
        owner(),
      ),
    ).rejects.toThrowError(NotFoundError);
  });

  it("lets the resolver refuse an inviter", async ({ expect }) => {
    const { service, resource } = await setup();
    resource.inviterAllowed = false;

    await expect(
      service.create(
        { email: "guest@example.com", resourceType: "widget", resourceId: "7" },
        owner(),
      ),
    ).rejects.toThrowError(ForbiddenError);
  });

  it("refuses an address the resolver says is already a principal", async ({
    expect,
  }) => {
    const { service, resource } = await setup();
    const guestId = crypto.randomUUID();
    resource.emails.set("guest@example.com", guestId);
    resource.principals.set("7", new Set([guestId]));

    await expect(
      service.create(
        { email: "guest@example.com", resourceType: "widget", resourceId: "7" },
        owner(),
      ),
    ).rejects.toThrowError("User is already a member of this resource");
  });

  it("refuses a second pending invitation for the same address", async ({
    expect,
  }) => {
    const { service } = await setup();
    const inviter = owner();
    const data = {
      email: "guest@example.com",
      resourceType: "widget",
      resourceId: "7",
    };

    await service.create(data, inviter);
    await expect(service.create(data, inviter)).rejects.toThrowError(
      "A pending invitation already exists",
    );
  });

  it("refuses a self-invite", async ({ expect }) => {
    const { service } = await setup();
    const inviter = owner();

    await expect(
      service.create(
        { email: "OWNER@example.com", resourceType: "widget", resourceId: "7" },
        inviter,
      ),
    ).rejects.toThrowError("Cannot invite yourself");
  });

  /**
   * The dimension a second consumer would lean on hardest, and the one Lore
   * has never exercised: every Lore accept writes `owner: false` and reads
   * neither field. Carried untouched from `create` to `grant` is the whole
   * contract, so it is asserted here rather than left to a downstream app to
   * discover.
   */
  it("carries roles and metadata untouched from create to grant", async ({
    expect,
  }) => {
    const { service, resource } = await setup();
    const guest = { id: crypto.randomUUID(), email: "guest@example.com" };

    const invitation = await service.create(
      {
        email: guest.email,
        resourceType: "widget",
        resourceId: "7",
        roles: ["editor", "billing"],
        metadata: { seat: "trial", invitedFrom: "settings" },
      },
      owner(),
    );

    expect(invitation.roles).toEqual(["editor", "billing"]);
    expect(invitation.metadata).toEqual({
      seat: "trial",
      invitedFrom: "settings",
    });

    await service.accept(invitation.id, guest);

    expect(resource.grants).toEqual([
      { userId: guest.id, roles: ["editor", "billing"] },
    ]);
  });

  it("grants on accept, and only when the person is not already a principal", async ({
    expect,
  }) => {
    const { service, resource } = await setup();
    const guest = { id: crypto.randomUUID(), email: "guest@example.com" };

    const first = await service.create(
      { email: guest.email, resourceType: "widget", resourceId: "7" },
      owner(),
    );
    const accepted = await service.accept(first.id, guest);
    expect(accepted).toEqual({ resourceType: "widget", resourceId: "7" });
    expect(resource.grants).toHaveLength(1);

    // A second invitation to a resource they are now on resolves without a
    // second grant: the resolver said they are already a principal.
    const second = await service.create(
      { email: guest.email, resourceType: "widget", resourceId: "8" },
      owner(),
    );
    resource.principals.set("8", new Set([guest.id]));
    await service.accept(second.id, guest);
    expect(resource.grants).toHaveLength(1);
  });

  it("refuses an accept from a different address", async ({ expect }) => {
    const { service } = await setup();
    const invitation = await service.create(
      { email: "guest@example.com", resourceType: "widget", resourceId: "7" },
      owner(),
    );

    await expect(
      service.accept(invitation.id, {
        id: crypto.randomUUID(),
        email: "someone-else@example.com",
      }),
    ).rejects.toThrowError("This invitation is not addressed to you");
  });

  it("asks for room again at accept, not only at create", async ({
    expect,
  }) => {
    const { service, resource } = await setup();
    const guest = { id: crypto.randomUUID(), email: "guest@example.com" };

    const invitation = await service.create(
      { email: guest.email, resourceType: "widget", resourceId: "7" },
      owner(),
    );

    // The last seat is taken between the invitation and the answer, which is
    // exactly what the second check exists for.
    resource.seats = 0;

    await expect(service.accept(invitation.id, guest)).rejects.toThrowError(
      "Full",
    );
  });

  it("expires a pending invitation, and refuses to accept it afterwards", async ({
    expect,
  }) => {
    const { service, dateTime } = await setup();
    const guest = { id: crypto.randomUUID(), email: "guest@example.com" };

    const invitation = await service.create(
      { email: guest.email, resourceType: "widget", resourceId: "7" },
      owner(),
    );

    // Default expiry is 7 days. `travel()` also releases every cron in the
    // container, so `InvitationJobs` may have swept the row before `accept`
    // ever reads it: assert the END STATE and the refusal, never which of the
    // two refusals won the race.
    await dateTime.travel([8, "days"]);

    await expect(service.accept(invitation.id, guest)).rejects.toThrowError(
      BadRequestError,
    );
    expect((await service.getById(invitation.id)).status).toBe("expired");
  });

  it("kills a revoked invitation for both answers", async ({ expect }) => {
    const { service } = await setup();
    const inviter = owner();
    const guest = { id: crypto.randomUUID(), email: "guest@example.com" };

    const invitation = await service.create(
      { email: guest.email, resourceType: "widget", resourceId: "7" },
      inviter,
    );
    await service.revoke(invitation.id, { id: inviter.id });

    await expect(service.accept(invitation.id, guest)).rejects.toThrowError(
      "Invitation is not pending",
    );
    await expect(service.decline(invitation.id, guest)).rejects.toThrowError(
      "Invitation is not pending",
    );
  });

  it("describes an inbox row through the resolver", async ({ expect }) => {
    const { service } = await setup();
    const guest = { id: crypto.randomUUID(), email: "guest@example.com" };

    await service.create(
      { email: guest.email, resourceType: "widget", resourceId: "7" },
      owner(),
    );

    const inbox = await service.listForUser(guest);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].resourceTitle).toBe("Widget 7");
    expect(inbox[0].inviterName).toBe("Someone");
  });

  it("still lists a row whose resourceType has no resolver left", async ({
    expect,
  }) => {
    const { service, alepha } = await setup();
    const guest = { id: crypto.randomUUID(), email: "guest@example.com" };

    await service.create(
      { email: guest.email, resourceType: "widget", resourceId: "7" },
      owner(),
    );

    // Write a row for a type nothing registers, the way an application that
    // dropped a resource kind would leave one behind.
    const repo = alepha.inject(InvitationService) as unknown as {
      repo: {
        create: (data: Record<string, unknown>) => Promise<InvitationEntity>;
      };
    };
    await repo.repo.create({
      invitedBy: crypto.randomUUID(),
      email: guest.email,
      resourceType: "gizmo",
      resourceId: "1",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const inbox = await service.listForUser(guest);
    expect(inbox).toHaveLength(2);
    // Undescribed rather than absent: its owner still has to be able to
    // decline it.
    const orphan = inbox.find((row) => row.resourceType === "gizmo");
    expect(orphan?.resourceTitle).toBeUndefined();
  });

  it("expires pending rows past their date, and purges resolved ones", async ({
    expect,
  }) => {
    const { service, dateTime } = await setup();
    const guest = { id: crypto.randomUUID(), email: "guest@example.com" };

    const invitation = await service.create(
      { email: guest.email, resourceType: "widget", resourceId: "7" },
      owner(),
    );

    // Nothing is due yet, and that count IS safe to assert: no clock has
    // moved, so no cron has fired.
    expect(await service.expirePending()).toBe(0);
    expect(await service.purgeResolved()).toBe(0);

    await dateTime.travel([8, "days"]);
    // Past here, counts are meaningless: `travel()` releases `InvitationJobs`
    // too, and whether the sweep or this call finds the row first is a race.
    // The end state is the claim.
    await service.expirePending();
    expect((await service.getById(invitation.id)).status).toBe("expired");

    // Default purge window is 90 days after resolution.
    await dateTime.travel([91, "days"]);
    await service.purgeResolved();
    await expect(service.getById(invitation.id)).rejects.toThrowError();
  });

  it("refuses to delete a pending invitation", async ({ expect }) => {
    const { service } = await setup();
    const invitation = await service.create(
      { email: "guest@example.com", resourceType: "widget", resourceId: "7" },
      owner(),
    );

    await expect(service.deleteInvitation(invitation.id)).rejects.toThrowError(
      BadRequestError,
    );
  });
});
