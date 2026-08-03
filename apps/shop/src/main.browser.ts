import { Alepha, run } from "alepha";
import { ShopWeb } from "./web/index.ts";

const alepha = Alepha.create();
alepha.with(ShopWeb);

run(alepha);
