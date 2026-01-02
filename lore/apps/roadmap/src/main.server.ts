import { AlephaBucketVercel } from "@alepha/bucket-vercel";
import { AlephaDevtools } from "@alepha/devtools";
import { Alepha, run } from "alepha";
import { RoadmapApi } from "./api/index.ts";
import { RoadmapMcp } from "./mcp/index.ts";
import { RoadmapWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "RDM",
  },
});

if (alepha.isProduction() && alepha.env.BLOB_READ_WRITE_TOKEN) {
  alepha.with(AlephaBucketVercel);
}

if (!alepha.isProduction()) {
  alepha.with(AlephaDevtools);
}

alepha.with(RoadmapApi);
alepha.with(RoadmapWeb);
alepha.with(RoadmapMcp);

run(alepha);
