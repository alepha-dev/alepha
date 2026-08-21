import { Alepha } from "alepha";
import { DatabaseProvider } from "alepha/orm";
import { NodePostgresProvider } from "alepha/orm/postgres";

import { TenantApp, tenancyTests } from "./tenancyTests.ts";

tenancyTests("postgres", async () => {
  const alepha = Alepha.create({
    env: {
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:15432/postgres",
    },
  }).with({ provide: DatabaseProvider, use: NodePostgresProvider });
  const app = alepha.inject(TenantApp);
  await alepha.start();
  return { alepha, app };
});
