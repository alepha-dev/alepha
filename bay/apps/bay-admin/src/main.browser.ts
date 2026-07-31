import { Alepha, run } from "alepha";
import { BayAdminWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(BayAdminWeb);

run(alepha);
