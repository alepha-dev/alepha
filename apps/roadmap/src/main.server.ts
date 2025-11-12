import { AlephaApiFiles } from "@alepha/api-files";
import { AlephaApiUsers } from "@alepha/api-users";
import { AlephaBucketVercel } from "@alepha/bucket-vercel";
import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { AlephaReactForm } from "@alepha/react-form";
import { AlephaServerCompress } from "@alepha/server-compress";
import { AlephaServerHelmet } from "@alepha/server-helmet";
import { AlephaServerMultipart } from "@alepha/server-multipart";
import { AlephaServerSecurity } from "@alepha/server-security";
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
alepha.with(AlephaServerMultipart);
alepha.with(AlephaBucketVercel);
alepha.with(AlephaApiFiles);
alepha.with(AlephaApiUsers);

alepha.with(RoadmapServices);
alepha.with(RoadmapApi);

alepha.with(AppRouter);

run(alepha);
