import { Alepha, run } from "alepha";

import { AppRouter } from "./AppRouter.ts";
import { CountApi } from "./CountApi.ts";
import { FixtureHooks } from "./FixtureHooks.ts";

const alepha = Alepha.create({ env: { APP_NAME: "DESKTOP_FIXTURE" } });

alepha.with(FixtureHooks);
alepha.with(CountApi);
alepha.with(AppRouter);

run(alepha);
