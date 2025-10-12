import { $hook, t } from "@alepha/core";
import { $entity, $repository, pg } from "@alepha/postgres";

const test = $entity({
	name: "test",
	schema: t.object({
		id: pg.primaryKey(t.int()),
	}),
});

export class Api {
	test = $repository(test);

	ready = $hook({
		on: "ready",
		handler: async () => {
			await this.test.find();
		},
	});
}
