import { $inject } from "@alepha/core";
import { $action } from "@alepha/server";
import { Db, users } from "../providers/Db.ts";

export class UserApi {
	db = $inject(Db);

	me = $action({
		schema: {
			response: users.$schema,
		},
		handler: async ({ user }) => {
			return await this.db.users.one({
				id: { eq: user.id },
			});
		},
	});
}
