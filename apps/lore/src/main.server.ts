import { Alepha, run } from "alepha";
import { CaptchaProvider, TurnstileCaptchaProvider } from "alepha/captcha";
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

// Register the captcha provider BEFORE any module that depends on `alepha/captcha`
// (e.g. `LoreApi` → `RealmController`). The `AlephaCaptcha` module auto-binds the
// memory provider on load; substituting after that point trips the DI guard.
alepha.with({ provide: CaptchaProvider, use: TurnstileCaptchaProvider });

alepha.with(LoreApi);
alepha.with(LoreMcp);
alepha.with(LoreWebApp);
alepha.with(LoreWebAdmin);

run(alepha);
