import { $inject, AlephaError, z } from "alepha";
import { identities, UserService } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

export class IdentityController {
  identities = $repository(identities);
  users = $inject(UserService);

  getMyIdentities = $action({
    use: [$secure({ permissions: ["identity:read"] })],
    schema: {
      response: z.array(
        z.object({
          id: z.uuid(),
          provider: z.string(),
          providerUserId: z.string().optional(),
          createdAt: z.datetime(),
          updatedAt: z.datetime(),
        }),
      ),
    },
    handler: async ({ user }) => {
      const userIdentities = await this.identities.findMany({
        where: { userId: { eq: user.id } },
      });

      return userIdentities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
      }));
    },
  });

  setPassword = $action({
    use: [$secure({ permissions: ["identity:update"] })],
    schema: {
      body: z.object({
        password: z.string().min(6).max(128),
      }),
      response: z.object({
        success: z.boolean(),
      }),
    },
    handler: async ({ user, body }) => {
      const { password } = body;

      // The logged-in user's email is the identifier — no username to ask for
      // since `username: "none"` in the realm settings.
      if (!user.email) {
        throw new AlephaError(
          "Cannot set password without an email on the account",
        );
      }

      // The realm's credentials provider is named "credentials" (see
      // CampaignSecurityService `identities.credentials`). Login looks up that
      // provider and reads the top-level `password` column — so the password
      // MUST be written there, not under a custom provider / `providerData`.
      const existingIdentity = await this.identities.findOne({
        where: {
          provider: { eq: "credentials" },
          userId: { eq: user.id },
        },
      });

      if (existingIdentity) {
        throw new AlephaError("Password identity already exists for this user");
      }

      // Delegate to the framework's canonical password-set flow — the same one
      // the admin `/admin/users/:id` screen uses. It upserts a "credentials"
      // identity with the hash in the top-level `password` column, applies the
      // realm password policy, and audits the change, keeping `/me` in lockstep
      // with registration, password reset, and admin.
      await this.users.setPassword(user.id, password);

      return { success: true };
    },
  });
}
