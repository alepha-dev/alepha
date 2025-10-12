import { t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export { files } from "@alepha/api-files/src/entities/files.ts";
export { jobExecutions } from "@alepha/api-jobs/src/entities/jobExecutions.ts";
export { identities } from "@alepha/api-users/src/entities/identities.ts";
export { sessions } from "@alepha/api-users/src/entities/sessions.ts";
export { users } from "@alepha/api-users/src/entities/users.ts";

export const test = $entity({
	name: "test",
	schema: t.object({
		id: pg.primaryKey(t.int()),
	}),
});
