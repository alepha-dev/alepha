import { Alepha, run } from "alepha";
import { helmetOptions } from "alepha/server";

import { AppRouter } from "./AppRouter.ts";
import { CountApi } from "./CountApi.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "EXAMPLE_SSR",
  },
});

// The strict Content Security Policy (#E130): scripts by hash or per-request
// nonce, no 'unsafe-inline'. The e2e suite runs under it and fails on the
// first violation, so it stays true.
alepha.store.mut(helmetOptions, (old) => ({
  ...old,
  contentSecurityPolicy: {},
}));

alepha.with(CountApi);
alepha.with(AppRouter);

run(alepha);
