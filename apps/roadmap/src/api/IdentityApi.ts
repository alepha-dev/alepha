import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { CryptoProvider } from "@alepha/security";
import { Db, identities } from "./providers/Db.ts";

export class IdentityApi {
	db = $inject(Db);
	crypto = $inject(CryptoProvider);

	getMyIdentities = $action({
		schema: {
			response: t.array(
				t.object({
					id: t.uuid(),
					provider: t.string(),
					providerUserId: t.string(),
					createdAt: t.datetime(),
					updatedAt: t.datetime(),
				}),
			),
		},
		handler: async ({ user }) => {
			const userIdentities = await this.db.identities.find({
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
			const existingIdentity = await this.db.identities
				.findOne({
					provider: { eq: "usernamePassword" },
					userId: { eq: user.id },
				})
				.catch(() => null);

			if (existingIdentity) {
				throw new Error("Password identity already exists for this user");
			}

			// Check if username is already taken
			const existingUsername = await this.db.identities
				.findOne({
					provider: { eq: "usernamePassword" },
					providerUserId: { eq: username },
				})
				.catch(() => null);

			if (existingUsername) {
				throw new Error("Username is already taken");
			}

			// Hash the password
			const hashedPassword = await this.crypto.hashPassword(password);

			// Create the identity
			await this.db.identities.create({
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