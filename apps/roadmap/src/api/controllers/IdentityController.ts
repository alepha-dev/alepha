import { $inject, AlephaError, t } from "alepha";
import { identities } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { $secure, CryptoProvider } from "alepha/security";
import { $action } from "alepha/server";

export class IdentityController {
  identities = $repository(identities);
  crypto = $inject(CryptoProvider);

  getMyIdentities = $action({
    use: [$secure({ permissions: ["identity:read"] })],
    schema: {
      response: t.array(
        t.object({
          id: t.uuid(),
          provider: t.string(),
          providerUserId: t.optional(t.string()),
          createdAt: t.datetime(),
          updatedAt: t.datetime(),
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
      body: t.object({
        password: t.string({ minLength: 6, maxLength: 128 }),
      }),
      response: t.object({
        success: t.boolean(),
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

      // Check if usernamePassword identity already exists
      const existingIdentity = await this.identities.findOne({
        where: {
          provider: { eq: "usernamePassword" },
          userId: { eq: user.id },
        },
      });

      if (existingIdentity) {
        throw new AlephaError("Password identity already exists for this user");
      }

      // Hash the password
      const hashedPassword = await this.crypto.hashPassword(password);

      // Create the identity. `providerUserId` is the email — the only
      // identifier we collect.
      await this.identities.create({
        userId: user.id,
        provider: "usernamePassword",
        providerUserId: user.email,
        providerData: {
          password: hashedPassword,
        },
      });

      return { success: true };
    },
  });
}
