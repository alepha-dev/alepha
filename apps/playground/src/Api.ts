import { $authGoogle, $realmUsers } from "@alepha/api-users";
import { $hook, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { $repository } from "@alepha/postgres";
import { $scheduler } from "@alepha/scheduler";
import { $action } from "@alepha/server";
import { test } from "./entities";

export class Api {
	log = $logger();
	test = $repository(test);

	realm = $realmUsers();
	google = $authGoogle(this.realm);

	ready = $hook({
		on: "ready",
		handler: async () => {
			await this.test.find();
		},
	});

	thinking = $scheduler({
		cron: "*/1 * * * *", // every minute
		handler: async () => {
			this.log.info("Thinking...");
		},
	});

	ping = $action({
		schema: {
			response: t.object({ pong: t.boolean() }),
		},
		handler: async () => {
			return { pong: true };
		},
	});
}
