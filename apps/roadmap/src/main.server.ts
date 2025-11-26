import { AlephaBucketVercel } from "@alepha/bucket-vercel";
import { AlephaReactAuth } from "@alepha/react/auth";
import { AlephaReactForm } from "@alepha/react/form";
import { AlephaUI } from "@alepha/ui";
import { AlephaUIAuth } from "@alepha/ui/auth";
import { Alepha, run } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaServerCache } from "alepha/server/cache";
import { AlephaServerCompress } from "alepha/server/compress";
import { AlephaServerHelmet } from "alepha/server/helmet";
import { AlephaServerMultipart } from "alepha/server/multipart";
import { AlephaServerSecurity } from "alepha/server/security";
import { AppRouter } from "./AppRouter.ts";
import { RoadmapApi } from "./api/index.ts";
import { RoadmapServices } from "./services/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "RDM",
  },
});

alepha.with(AlephaReactAuth);
alepha.with(AlephaReactForm);
alepha.with(AlephaServerHelmet);
alepha.with(AlephaServerSecurity);
alepha.with(AlephaServerCompress);
alepha.with(AlephaServerCache);
alepha.with(AlephaServerMultipart);
alepha.with(AlephaApiFiles);
alepha.with(AlephaApiUsers);
alepha.with(AlephaUI);
alepha.with(AlephaUIAuth);

if (alepha.isProduction() && alepha.env.BLOB_READ_WRITE_TOKEN) {
  alepha.with(AlephaBucketVercel);
}

alepha.with(RoadmapServices);
alepha.with(RoadmapApi);

alepha.with(AppRouter);

run(alepha);
