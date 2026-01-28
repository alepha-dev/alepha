export const mainBrowserTs = () =>
  `
import { Alepha, run } from "alepha";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(WebModule);

run(alepha);
`.trim();
