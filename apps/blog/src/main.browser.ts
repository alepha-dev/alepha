import { Alepha, run } from "alepha";
import { BlogWeb } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(BlogWeb);

run(alepha);
