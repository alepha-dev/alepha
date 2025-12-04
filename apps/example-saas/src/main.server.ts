import { Alepha, run } from "alepha";
import { ExampleSaasApi } from "./api/index.ts";
import { ExampleSaasWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    POSTGRES_SCHEMA: "saas",
  },
});

alepha.with(ExampleSaasApi);
alepha.with(ExampleSaasWeb);

run(alepha);
