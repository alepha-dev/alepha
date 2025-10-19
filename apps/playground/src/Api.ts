import { $authGoogle, $realmUsers } from "@alepha/api-users";
import { $logger } from "@alepha/logger";
import { $scheduler } from "@alepha/scheduler";

export class Api {
	log = $logger();

	realm = $realmUsers();
	google = $authGoogle(this.realm);

	thinking = $scheduler({
		cron: "*/1 * * * *", // every minute
		handler: async () => {
			this.log.info("Thinking...");
		},
	});
}
