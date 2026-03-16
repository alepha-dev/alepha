import { Alepha, run } from "alepha";
import { BlogApi } from "./api/index.ts";
import { BlogMcp } from "./mcp/index.ts";
import { BlogWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "BLOG",
  },
});

alepha.with(BlogApi);
alepha.with(BlogMcp);
alepha.with(BlogWeb);

run(alepha);
