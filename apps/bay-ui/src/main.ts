import { Alepha, run } from "alepha";
import { BayUiApi } from "./api/index.ts";
import { BayUiWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "BAY_UI",
  },
});

alepha.with(BayUiApi);
alepha.with(BayUiWeb);

run(alepha);
