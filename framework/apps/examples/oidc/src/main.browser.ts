import { Alepha, run } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";

import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AlephaReactAuth);
alepha.with(AppRouter);

run(alepha);
