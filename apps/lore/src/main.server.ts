import { SigilSinkProvider } from "@alepha/sigil/server";
import { Alepha, run } from "alepha";
import { FileAccessProvider } from "alepha/api/files";
import { oauthOptions } from "alepha/api/oauth";
import { CaptchaProvider, TurnstileCaptchaProvider } from "alepha/captcha";
import { AlephaEmailCloudflare } from "alepha/email/cloudflare";
import { LoreWebAdmin } from "@/web/admin/index.ts";
import { LoreApi } from "./api/index.ts";
import { LoreFileAccessProvider } from "./api/providers/LoreFileAccessProvider.ts";
import { LoreSigilSinkProvider } from "./api/providers/LoreSigilSinkProvider.ts";
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
// lore-aware rules (avatars are public-authed, project icons follow
// project visibility, quest attachments require project membership,
// feedback attachments require project ownership).
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

// Lore reports to Lore, and this line is what makes that possible.
//
// It is both the reporting app and the sink, so the ordinary transport would
// have the Worker fetch its own hostname — a subrequest Cloudflare refuses.
// Both call sites in `SigilSinkProvider` are fail-open, so that refusal shows
// up nowhere: Lore would look enrolled and report nothing. The substitution
// answers those two calls in process instead, against its own services.
//
// It must come BEFORE `LoreWebApp`, which is what registers `AlephaSigil` and
// therefore the provider being replaced here.
alepha.with({ provide: SigilSinkProvider, use: LoreSigilSinkProvider });

alepha.with(LoreWebApp);
alepha.with(LoreWebAdmin);

run(alepha);
