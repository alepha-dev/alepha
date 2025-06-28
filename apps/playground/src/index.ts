import { $hook, $inject, run, t } from "@alepha/core";
import { $entity, PostgresModule, pg, Repository } from "@alepha/postgres";

const users = $entity({
	name: "users",
	schema: t.object({
		id: pg.primaryKey(),
		name: t.string(),
	}),
});

class UserRepository extends Repository.of(users) {}

class App {
	users = $inject(UserRepository);
	ready = $hook({
		name: "ready",
		handler: async () => {
			const users = await this.users.find();
			console.log("Users:", users);
		},
	});
}

run([PostgresModule, App]);
