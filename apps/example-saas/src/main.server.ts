import { Alepha, run } from "alepha";
import { SaasAdm } from "./adm/index.ts";
import { SaasApi } from "./api/index.ts";
import { SaasCws } from "./cws/index.ts";
import { SaasHome } from "./home/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "API",
    POSTGRES_SCHEMA: "saas",
  },
});

alepha.with(SaasApi);
alepha.with(SaasAdm);
alepha.with(SaasCws);
alepha.with(SaasHome);

run(alepha);
