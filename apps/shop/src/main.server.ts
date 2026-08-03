import { Alepha, run } from "alepha";
import { ShopApi } from "./api/index.ts";
import { ShopWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "SHOP",
  },
});

alepha.with(ShopApi);
alepha.with(ShopWeb);

run(alepha);
