import { AlephaBucketVercel } from "@alepha/bucket-vercel";
import { Alepha, run } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaServerCache } from "alepha/server/cache";
import { AlephaServerCompress } from "alepha/server/compress";
import { AlephaServerHelmet } from "alepha/server/helmet";
import { AlephaServerMultipart } from "alepha/server/multipart";
import { AlephaServerSecurity } from "alepha/server/security";
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

alepha.with(AlephaServerHelmet);
alepha.with(AlephaServerSecurity);
alepha.with(AlephaServerCompress);
alepha.with(AlephaServerCache);
alepha.with(AlephaServerMultipart);
alepha.with(AlephaApiFiles);
alepha.with(AlephaApiUsers);

alepha.with(RoadmapApi);
alepha.with(RoadmapWeb);
alepha.with(RoadmapMcp);

run(alepha);
