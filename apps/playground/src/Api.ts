import { t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { $entity, $repository, pg } from "@alepha/postgres";

const organizations = $entity({
  name: "organizations",
  schema: t.object({
    id: pg.primaryKey(),
  }),
});

export class Api {
  log = $logger();
  orgs = $repository(organizations);

  // realm = $realmUsers();
  // google = $authGoogle(this.realm);
  //
  // thinking = $scheduler({
  // 	cron: "*/1 * * * *", // every minute
  // 	handler: async () => {
  // 		this.log.info("Thinking...");
  // 	},
  // });
}
