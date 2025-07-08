import {
	$hook,
	$inject,
	$logger,
	Alepha,
	type Module,
	run,
	t,
} from "@alepha/core";
import { $db, $entity, AlephaPostgres, pg } from "@alepha/postgres";
import {
	AlephaServerMetrics,
	ServerMetricsProvider,
} from "@alepha/server-metrics";
import { sql } from "drizzle-orm";

const users = $entity({
	name: "users",
	schema: t.object({
		id: pg.primaryKey(),
		nickname: t.string(),
	}),
});

const posts = $entity({
	name: "posts",
	schema: t.object({
		id: pg.primaryKey(),
		userId: pg.ref(t.int(), () => users.id),
		content: t.string(),
	}),
});

class App {
	log = $logger();
	users = $inject(users);
	posts = $inject(posts);
	alepha = $inject(Alepha);

	db = $db({
		entities: { users, posts },
	});

	ready = $hook({
		on: "ready",
		handler: async () => {
			const user = await this.users.create({
				nickname: "John Doe",
			});

			await this.posts.create({
				userId: user.id,
				content: "Hello, world!",
			});

			await this.posts.create({
				userId: user.id,
				content: "ss, world!",
			});

			this.log.info(await this.db.users.find());

			const n = await this.db.execute(
				sql`select ${posts.content}, nickname from ${users} join ${posts} on ${users.id} = ${posts.userId}`,
				t.composite([
					t.pick(users.$schema, ["nickname"]),
					t.pick(posts.$schema, ["content"]),
				]),
			);

			this.log.info(await this.db.posts.find());

			this.log.info(n);

			this.log.info("Users:", await this.users.find());
		},
	});
}

class Playground implements Module {
	$services = (alepha: Alepha) =>
		alepha.with(AlephaPostgres).with(AlephaServerMetrics).with(App);
}

const alepha = Alepha.create({
	env: {},
})
	.with(Playground)
	.configure(ServerMetricsProvider, {
		prefix: "playground_",
	});

run(alepha);
