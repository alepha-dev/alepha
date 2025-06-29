import { $hook, $inject, type Alepha, type Module, run, t } from "@alepha/core";
import {
	$entity,
	AlephaPostgresModule,
	pg,
	Repository,
} from "@alepha/postgres";

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

class AppModule implements Module {
	$services(alepha: Alepha) {
		alepha.with(AlephaPostgresModule);
		alepha.with(App);
	}
}

run(AppModule, {
	env: {
		POSTGRES_SCHEMA: "playground",
	},
});
