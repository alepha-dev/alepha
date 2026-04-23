import { Alepha, run } from "alepha";
import { AlephaEmailBrevo } from "alepha/email/brevo";
import { RoadmapWebAdmin } from "@/web/admin/index.ts";
import { RoadmapApi } from "./api/index.ts";
import { RoadmapMcp } from "./mcp/index.ts";
import { RoadmapWebApp } from "./web/app/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "RDM",
  },
});

if (alepha.env.BREVO_API_KEY) {
  alepha.with(AlephaEmailBrevo);
}

alepha.with(RoadmapApi);
alepha.with(RoadmapMcp);
alepha.with(RoadmapWebApp);
alepha.with(RoadmapWebAdmin);

run(alepha);
