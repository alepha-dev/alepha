import { $repository, type Page } from "@alepha/postgres";
import type { IdentityEntity } from "../entities/identities.ts";
import { identities } from "../entities/identities.ts";
import type { IdentityQuery } from "../schemas/identityQuerySchema.ts";

export class IdentityService {
	public readonly identities = $repository(identities);

	/**
	 * Find identities with pagination and filtering.
	 */
	public async findIdentities(
		q: IdentityQuery = {},
	): Promise<Page<IdentityEntity>> {
		q.sort ??= "-createdAt";

		const where = this.identities.createQueryWhere();

		if (q.userId) {
			where.userId = { eq: q.userId };
		}

		if (q.provider) {
			where.provider = { like: q.provider };
		}

		return await this.identities.paginate(q, { where }, { count: true });
	}

	/**
	 * Get an identity by ID.
	 */
	public async getIdentityById(id: string): Promise<IdentityEntity> {
		return await this.identities.findById(id);
	}

	/**
	 * Delete an identity by ID.
	 */
	public async deleteIdentity(id: string): Promise<void> {
		// Verify identity exists
		await this.getIdentityById(id);

		await this.identities.deleteById(id);
	}
}
