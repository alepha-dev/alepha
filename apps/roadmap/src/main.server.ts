import { AlephaBucketVercel } from "@alepha/bucket-vercel";
import { AlephaDevtools } from "@alepha/devtools";
import { Alepha, run } from "alepha";
import { RoadmapApi } from "./api/index.ts";
import { RoadmapMcp } from "./mcp/index.ts";
import { RoadmapWebAdmin } from "./web/admin/index.ts";
import { RoadmapWebApp } from "./web/app/index.ts";

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
alepha.with(RoadmapMcp);
alepha.with(RoadmapWebApp);
alepha.with(RoadmapWebAdmin);

run(alepha);
