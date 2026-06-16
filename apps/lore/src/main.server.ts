import { SigilForwardProvider, sigilOptions } from "@alepha/sigil/server";
import { Alepha, run } from "alepha";
import { FileAccessProvider } from "alepha/api/files";
import { oauthOptions } from "alepha/api/oauth";
import { CaptchaProvider, TurnstileCaptchaProvider } from "alepha/captcha";
import { AlephaEmailCloudflare } from "alepha/email/cloudflare";
import { LoreWebAdmin } from "@/web/admin/index.ts";
import { LoreApi } from "./api/index.ts";
import { LoreFileAccessProvider } from "./api/providers/LoreFileAccessProvider.ts";
import { LoreSigilForwardProvider } from "./api/providers/LoreSigilForwardProvider.ts";
import { LoreMcp } from "./mcp/index.ts";
import { LoreWebApp } from "./web/app/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "RDM",
  },
});

// Cloudflare Email Sending. Registered only in production — both the real
// Workers runtime and the CF build (Vite bakes `NODE_ENV=production`, so
// `isProduction()` is true there and the build can still introspect the module
// to emit the `send_email` binding into `wrangler.jsonc`). Skipped in `alepha
// dev` to avoid the provider's "not running on Workers" inert-boot warning.
if (alepha.isProduction()) {
  alepha.with(AlephaEmailCloudflare);
}

// Register the captcha provider BEFORE any module that depends on `alepha/captcha`
// (e.g. `LoreApi` → `RealmController`). The `AlephaCaptcha` module auto-binds the
// memory provider on load; substituting after that point trips the DI guard.
// Register if and only if TURNSTILE_SITE_KEY is present.
if (alepha.env.TURNSTILE_SITE_KEY) {
  alepha.with({ provide: CaptchaProvider, use: TurnstileCaptchaProvider });
}

// Widen the framework's creator-only `/api/files/:id` policy with
// lore-aware rules (avatars are public-authed, campaign icons follow
// campaign visibility, quest attachments require campaign membership,
// petition attachments require campaign ownership).
alepha.with({ provide: FileAccessProvider, use: LoreFileAccessProvider });

// Configure the OAuth 2.1 authorization server BEFORE `LoreApi` (which holds
// the `$realm`). `$realm` merges this value and only overrides `realm`, so
// `resource` and `loginPath` set here are preserved. `loginPath` points at
// Lore's actual login route; the OAuth `authorize` endpoint redirects
// unauthenticated users there.
alepha.set(oauthOptions, {
  realm: "default",
  resource: "/mcp",
  loginPath: "/auth/login",
});

alepha.with(LoreApi);
alepha.with(LoreMcp);

// Lore dogfoods its own sigil, so it is BOTH the partner app and the receiver.
// Substitute the sigil's HTTP forward provider with an in-process one BEFORE
// `LoreWebApp` loads `AlephaSigil` (which declares `SigilForwardProvider` —
// substituting after that point trips the DI guard). This avoids the
// Cloudflare Worker self-call (the Worker fetching its own hostname) that made
// `/sigil/request` 404 and silently dropped telemetry. `LoreApi` is loaded
// first so the in-process provider's `SigilService` / `SigilIngestRunner`
// dependencies are available.
alepha.with({ provide: SigilForwardProvider, use: LoreSigilForwardProvider });

// Lore embeds its own sigil — suppress the feedback button on the petition
// request page itself (the button there would just point back at the same
// form). SIGIL_ID / SIGIL_FEATURES come from env; this only adds the path
// filter. Set server-side (the secret-bearing options atom never reaches the
// browser); the per-request publisher copies excludedPaths into the public
// client atom for the embed.
alepha.set(sigilOptions, { excludedPaths: ["/c/*/request"] });

alepha.with(LoreWebApp);
alepha.with(LoreWebAdmin);

run(alepha);
