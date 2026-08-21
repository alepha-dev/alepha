import { Alepha } from "alepha";

import { TenantApp, tenancyTests } from "./tenancyTests.ts";

tenancyTests("sqlite", async () => {
  const alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  const app = alepha.inject(TenantApp);
  await alepha.start();
  return { alepha, app };
});
