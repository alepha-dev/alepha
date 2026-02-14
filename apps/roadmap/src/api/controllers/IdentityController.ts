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
        username: t.string({ minLength: 3, maxLength: 50 }),
        password: t.string({ minLength: 6, maxLength: 128 }),
      }),
      response: t.object({
        success: t.boolean(),
      }),
    },
    handler: async ({ user, body }) => {
      const { username, password } = body;

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

      // Check if username is already taken
      const existingUsername = await this.identities.findOne({
        where: {
          provider: { eq: "usernamePassword" },
          providerUserId: { eq: username },
        },
      });

      if (existingUsername) {
        throw new AlephaError("Username is already taken");
      }

      // Hash the password
      const hashedPassword = await this.crypto.hashPassword(password);

      // Create the identity
      await this.identities.create({
        userId: user.id,
        provider: "usernamePassword",
        providerUserId: username,
        providerData: {
          password: hashedPassword,
        },
      });

      return { success: true };
    },
  });
}
