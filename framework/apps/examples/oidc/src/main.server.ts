import { Alepha, run } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaServerAuth } from "alepha/server/auth";

import { AppRouter } from "./AppRouter.ts";
import { Auth } from "./Auth.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "OIDC example",
  },
});

alepha.with(AlephaServerAuth);
alepha.with(AlephaReactAuth);
alepha.with(Auth);
alepha.with(AppRouter);

run(alepha);
