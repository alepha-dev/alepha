import { $inject } from "@alepha/core";
import { Repository } from "@alepha/postgres";
import { UnauthorizedError } from "@alepha/server";
import { users } from "../entities/users.ts";
import { CryptoService } from "../services/CryptoService.ts";

export class UserRepository extends Repository.of(users) {
	crypto = $inject(CryptoService);

	async createAccount(email: string, password: string) {
		return await this.create({
			email,
			password,
		});
	}

	async getByEmail(email: string) {
		return await this.findOne({
			email: { eq: email },
		});
	}

	async login(email: string, password: string) {
		const user = await this.getByEmail(email);

		if (!user) {
			throw new UnauthorizedError();
		}

		const isValid = await this.crypto.verifyPassword(password, user.password);
		if (!isValid) {
			throw new UnauthorizedError();
		}

		return user;
	}
}
