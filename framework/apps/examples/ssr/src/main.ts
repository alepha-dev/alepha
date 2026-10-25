import { Alepha, run } from "alepha";

import { AppRouter } from "./AppRouter.ts";
import { CountApi } from "./CountApi.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "EXAMPLE_SSR",
  },
});

alepha.with(CountApi);
alepha.with(AppRouter);

run(alepha);
