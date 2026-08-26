import { Alepha, run } from "alepha";

import { TotpApi } from "./api/index.ts";
import { TotpWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "TOTP",
  },
});

alepha.with(TotpApi);
alepha.with(TotpWeb);

run(alepha);
