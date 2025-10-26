import { AlephaApiFiles } from "@alepha/api-files";
import { AlephaApiJobs } from "@alepha/api-jobs";
import { AlephaApiNotifications } from "@alepha/api-notifications";
import { AlephaApiUsers } from "@alepha/api-users";
import { Alepha, run, t } from "@alepha/core";
import { $entity, $repository, pg } from "@alepha/postgres";
import { AlephaReactHead } from "@alepha/react-head";
import { AlephaServerSwagger } from "@alepha/server-swagger";
import { Api } from "./Api.ts";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create({
  env: {
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
    POSTGRES_SCHEMA: "playground",
  },
});

const messages = $entity({
  name: "message",
  schema: t.object({
    id: pg.uuidPrimaryKey(),
    status: t.enum(["pending", "done", "failed"]),
    type: pg.enum(["raw", "binary"]),
  }),
});

const supports = $entity({
  name: "supports",
  schema: t.object({
    id: pg.uuidPrimaryKey(),
    type: pg.enum(["raw", "binary"]),
  }),
});

alepha.with(() => {
  return {
    messages: $repository(messages),
    supports: $repository(supports),
  };
});

alepha.with(AlephaReactHead);
alepha.with(AppRouter);

alepha.with(AlephaServerSwagger);
alepha.with(AlephaApiJobs);
alepha.with(AlephaApiFiles);
alepha.with(AlephaApiNotifications);
alepha.with(AlephaApiUsers);
alepha.with(Api);

run(alepha);
