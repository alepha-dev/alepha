import { Alepha, run } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";

import { SmokeApi } from "./SmokeApi.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "DEPLOY_SMOKE",
  },
});

alepha.with(AlephaApiFiles);
alepha.with(SmokeApi);

run(alepha);
