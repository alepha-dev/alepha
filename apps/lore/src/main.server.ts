import { Alepha, run } from "alepha";
import { AlephaEmailBrevo } from "alepha/email/brevo";
import { LoreWebAdmin } from "@/web/admin/index.ts";
import { LoreApi } from "./api/index.ts";
import { LoreMcp } from "./mcp/index.ts";
import { LoreWebApp } from "./web/app/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "RDM",
  },
});

if (alepha.env.BREVO_API_KEY) {
  alepha.with(AlephaEmailBrevo);
}

alepha.with(LoreApi);
alepha.with(LoreMcp);
alepha.with(LoreWebApp);
alepha.with(LoreWebAdmin);

run(alepha);
