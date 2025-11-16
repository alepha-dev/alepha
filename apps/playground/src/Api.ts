import { t } from "alepha";
import { $logger } from "alepha/logger";
import { $entity, $repository, pg } from "alepha/orm";
import { $action } from "alepha/server";
import { $swagger } from "alepha/server/swagger";

const organizations = $entity({
  name: "organizations",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.text(),
  }),
});

export class Api {
  log = $logger();
  orgs = $repository(organizations);

  docs = $swagger({
    info: {
      title: "Playground API",
      description: "API documentation for the Playground application",
      version: "1.0.0",
    },
  });

  // realm = $realmUsers();
  // google = $authGoogle(this.realm);
  //
  // thinking = $scheduler({
  // 	cron: "*/1 * * * *", // every minute
  // 	handler: async () => {
  // 		this.log.info("Thinking...");
  // 	},
  // });

  ping = $action({
    schema: {
      response: t.object({
        pong: t.boolean(),
      }),
    },
    handler: async () => {
      return { pong: true };
    },
  });
}
