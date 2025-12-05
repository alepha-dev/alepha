import { AlephaDevtools } from "@alepha/devtools";
import { Alepha, run } from "alepha";
import { StarterApi } from "./api/index.ts";
import { StarterWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    DATABASE_URL: "sqlite://:memory:",
  },
});

alepha.with(AlephaDevtools);
alepha.with(StarterWeb); // for SSR
alepha.with(StarterApi);

run(alepha);
