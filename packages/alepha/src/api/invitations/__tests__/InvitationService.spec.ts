import { Alepha } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { BadRequestError, ForbiddenError } from "alepha/server";
import { describe, it } from "vitest";
import type { InvitationEntity } from "../entities/invitations.ts";
import { AlephaApiInvitations } from "../index.ts";
import { InvitationProvider } from "../providers/InvitationProvider.ts";
import { InvitationService } from "../services/InvitationService.ts";

class TestInvitationProvider extends InvitationProvider {
  protected members = new Map<string, Set<string>>();

  async validateResource(
    _resourceType: string,
    _resourceId: string,
    _inviter: { id: string; email?: string },
  ): Promise<void> {
    // Always succeeds
  }

  async isMember(
    resourceType: string,
    resourceId: string,
    _email: string,
    userId?: string,
  ): Promise<boolean> {
    if (!userId) {
      return false;
    }

    const key = `${resourceType}:${resourceId}`;
    return this.members.get(key)?.has(userId) ?? false;
  }

  async onAccept(
    invitation: InvitationEntity,
    acceptedBy: { id: string; email?: string },
  ): Promise<void> {
    const key = `${invitation.resourceType}:${invitation.resourceId}`;

    if (!this.members.has(key)) {
      this.members.set(key, new Set());
    }

    this.members.get(key)!.add(acceptedBy.id);
  }

  async getResourceInfo(
    _resourceType: string,
    _resourceId: string,
  ): Promise<{ name: string; description?: string; url?: string }> {
    return { name: "Test Project" };
  }

  addMember(resourceType: string, resourceId: string, userId: string): void {
    const key = `${resourceType}:${resourceId}`;

    if (!this.members.has(key)) {
      this.members.set(key, new Set());
    }

    this.members.get(key)!.add(userId);
  }
}

class TestRepositories {
  users = $repository(users);
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with({ provide: InvitationProvider, use: TestInvitationProvider })
    .with(AlephaApiInvitations);

  const service = alepha.inject(InvitationService);
  const provider = alepha.inject(
    TestInvitationProvider,
  ) as TestInvitationProvider;
  const repos = alepha.inject(TestRepositories);
  await alepha.start();

  const createUser = async (email: string) => {
    return repos.users.create({ email, roles: [] });
  };

  return { alepha, service, provider, createUser };
};

describe("InvitationService", () => {
  // -----------------------------------------------------------------------------------------------------------------

  describe("create", () => {
    it("should create a pending invitation", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");

      const invitation = await service.create(
        {
          email: "invitee@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      expect(invitation.status).toBe("pending");
      expect(invitation.email).toBe("invitee@example.com");
      expect(invitation.resourceType).toBe("project");
      expect(invitation.resourceId).toBe("proj-1");
      expect(invitation.invitedBy).toBe(inviter.id);
      expect(invitation.token).toBeDefined();
      expect(invitation.expiresAt).toBeDefined();
    });

    it("should reject self-invite", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("self@example.com");

      await expect(
        service.create(
          {
            email: "self@example.com",
            resourceType: "project",
            resourceId: "proj-1",
          },
          { id: inviter.id, email: inviter.email },
        ),
      ).rejects.toThrow(BadRequestError);
    });

    it("should reject duplicate pending invitation", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");

      await service.create(
        {
          email: "dup@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await expect(
        service.create(
          {
            email: "dup@example.com",
            resourceType: "project",
            resourceId: "proj-1",
          },
          { id: inviter.id, email: inviter.email },
        ),
      ).rejects.toThrow(BadRequestError);
    });

    it("should reject when already a member", async ({ expect }) => {
      const { service, provider, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");
      const existingMember = await createUser("member@example.com");

      provider.addMember("project", "proj-1", existingMember.id);

      await expect(
        service.create(
          {
            email: "member@example.com",
            resourceType: "project",
            resourceId: "proj-1",
          },
          { id: inviter.id, email: inviter.email },
        ),
      ).rejects.toThrow(BadRequestError);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------

  describe("accept", () => {
    it("should accept invitation and call onAccept", async ({ expect }) => {
      const { service, provider, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");
      const invitee = await createUser("invitee@example.com");

      const invitation = await service.create(
        {
          email: "invitee@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await service.accept(invitation.id, {
        id: invitee.id,
        email: invitee.email,
      });

      const updated = await service.getById(invitation.id);
      expect(updated.status).toBe("accepted");
      expect(updated.resolvedBy).toBe(invitee.id);
      expect(updated.resolvedAt).toBeDefined();

      const isMember = await provider.isMember(
        "project",
        "proj-1",
        "invitee@example.com",
        invitee.id,
      );
      expect(isMember).toBe(true);
    });

    it("should reject accept for wrong email", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");
      const wrongUser = await createUser("wrong@example.com");

      const invitation = await service.create(
        {
          email: "invitee@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await expect(
        service.accept(invitation.id, {
          id: wrongUser.id,
          email: wrongUser.email,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("should reject accept for non-pending invitation", async ({
      expect,
    }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");
      const invitee = await createUser("invitee@example.com");

      const invitation = await service.create(
        {
          email: "invitee@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await service.accept(invitation.id, {
        id: invitee.id,
        email: invitee.email,
      });

      await expect(
        service.accept(invitation.id, {
          id: invitee.id,
          email: invitee.email,
        }),
      ).rejects.toThrow(BadRequestError);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------

  describe("decline", () => {
    it("should decline invitation", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");
      const invitee = await createUser("invitee@example.com");

      const invitation = await service.create(
        {
          email: "invitee@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await service.decline(invitation.id, {
        id: invitee.id,
        email: invitee.email,
      });

      const updated = await service.getById(invitation.id);
      expect(updated.status).toBe("declined");
      expect(updated.resolvedBy).toBe(invitee.id);
      expect(updated.resolvedAt).toBeDefined();
    });

    it("should reject decline for wrong email", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");
      const wrongUser = await createUser("wrong@example.com");

      const invitation = await service.create(
        {
          email: "invitee@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await expect(
        service.decline(invitation.id, {
          id: wrongUser.id,
          email: wrongUser.email,
        }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------

  describe("revoke", () => {
    it("should revoke pending invitation", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");

      const invitation = await service.create(
        {
          email: "invitee@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await service.revoke(invitation.id, { id: inviter.id });

      const updated = await service.getById(invitation.id);
      expect(updated.status).toBe("revoked");
      expect(updated.resolvedBy).toBe(inviter.id);
      expect(updated.resolvedAt).toBeDefined();
    });

    it("should reject revoke for non-pending", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");
      const invitee = await createUser("invitee@example.com");

      const invitation = await service.create(
        {
          email: "invitee@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await service.accept(invitation.id, {
        id: invitee.id,
        email: invitee.email,
      });

      await expect(
        service.revoke(invitation.id, { id: inviter.id }),
      ).rejects.toThrow(BadRequestError);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------

  describe("findByEmail", () => {
    it("should return enriched invitations with resource info", async ({
      expect,
    }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");

      await service.create(
        {
          email: "lookup@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      const results = await service.findByEmail("lookup@example.com");

      expect(results).toHaveLength(1);
      expect(results[0].email).toBe("lookup@example.com");
      expect(results[0].resourceName).toBe("Test Project");
      expect(results[0].invitedBy).toBe(inviter.id);
      expect(results[0].inviterEmail).toBe("inviter@example.com");
    });
  });

  // -----------------------------------------------------------------------------------------------------------------

  describe("findInvitations", () => {
    it("should return paginated results", async ({ expect }) => {
      const { service, createUser } = await setup();

      const inviter = await createUser("inviter@example.com");

      await service.create(
        {
          email: "page1@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      await service.create(
        {
          email: "page2@example.com",
          resourceType: "project",
          resourceId: "proj-1",
        },
        { id: inviter.id, email: inviter.email },
      );

      const page = await service.findInvitations({ size: 10 });

      expect(page.content.length).toBeGreaterThanOrEqual(2);
      expect(page.page.totalElements).toBeGreaterThanOrEqual(2);
    });
  });
});
