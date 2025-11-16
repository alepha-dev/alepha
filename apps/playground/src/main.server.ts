import { Alepha, run, t } from "alepha";
import { AlephaDevtools } from "alepha/devtools";
import { $entity, $repository, pg } from "alepha/orm";
import { AlephaReactHead } from "@alepha/react/head";
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
alepha.with(AlephaDevtools);

alepha.with(AppRouter);
alepha.with(Api);

run(alepha);
