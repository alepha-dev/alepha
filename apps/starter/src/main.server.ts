import { Alepha, run } from "@alepha/core";
import { Api } from "./api/Api.ts";
import { App } from "./app/App.ts";

const alepha = Alepha.create({
  env: {
    DATABASE_URL: "sqlite://:memory:",
  },
});

alepha.with(App); // for SSR
alepha.with(Api);

run(alepha);
