import { SigilSinkProvider } from "@alepha/lore/sigil";
import { adminRouterOptionsAtom } from "@alepha/ui/components/admin/admin-router-options";
import { Alepha, run } from "alepha";
import { FileAccessProvider } from "alepha/api/files";
import { oauthOptions } from "alepha/api/oauth";
import { CaptchaProvider, TurnstileCaptchaProvider } from "alepha/captcha";
import { AlephaEmailCloudflare } from "alepha/email/cloudflare";

import { loreAdminOptions } from "@/web/admin/adminChrome.tsx";
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

// SMTP, for a self-hosted instance that has a mail server. Registered only
// when EMAIL_HOST is set, because `AlephaEmailSmtp` substitutes
// `EmailProvider` unconditionally and a transport pointed at nothing would
// fail every send. Without it the container falls through to
// `LocalEmailProvider`, which writes mail to `${DATA_DIR}/emails` — a useful
// escape hatch for an operator with no SMTP, and the reason
// `verifyEmailRequired` and `resetPasswordAllowed` are off until this is
// configured (see `AppSecurityProvider`).
//
// ⚠️ **A dynamic import, and that is load-bearing.** This file is also the
// Cloudflare Worker entry. nodemailer requires `events`, `net` and `tls`,
// which workerd cannot `createRequire`, so a STATIC import put them in the
// Worker bundle and the production deploy died at boot validation with
// `Uncaught Error: createRequire is unavailable on workerd; cannot require
// "events"`. The `if` around it was never enough: an import is resolved at
// module load, not at the branch.
//
// `yarn v` never builds for cloudflare, so nothing local catches this class —
// only the deploy does. Do not turn this back into a static import.
//
// The condition needs nothing about workerd: a Worker sends through the
// Cloudflare `send_email` binding and never carries EMAIL_HOST, so the branch
// is false there and the chunk is never evaluated. And if one ever did carry
// it, throwing on a config that cannot work beats skipping it in silence.
if (alepha.env.EMAIL_HOST) {
  const { AlephaEmailSmtp } = await import("alepha/email/smtp");
  alepha.with(AlephaEmailSmtp);
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
  // The consent screen is the first page a third party ever sees from Lore -
  // Claude renders it when connecting to the MCP endpoint - so it says which
  // product it is asking on behalf of, and where the grant can be undone.
  productName: "Lore",
  connectionsPath: "/account/connections",
  /*
   * ⚠️ `mcp` is one scope and it is the whole application. A client holding it
   * reads and writes every project this account is a member of: quests,
   * folios, feedback, blights, the lot. The copy says so in those words rather
   * than in the word "mcp", which is what the screen used to print and which
   * tells a reader nothing about what they are handing over.
   */
  scopes: {
    mcp: {
      label: "Your projects",
      description:
        "Read and manage the projects you are a member of - their quests, folios, feedback and blights.",
    },
    openid: {
      label: "Who you are",
      description: "Your name and email address, so it can tell it is you.",
    },
  },
});

// Lore's admin chrome (the back-arrow brand + hidden name columns on the
// users table) is set here AND in main.browser.ts — server-only would leave
// the browser rendering default chrome after hydration.
alepha.set(adminRouterOptionsAtom, loreAdminOptions);

// Lore self-reports through its own sigil, so the floating feedback button
// renders on every Lore page — including the feedback form itself, where it
// offers to open the form you are already looking at. `*` matches within one
// path segment, so this covers `/sds/request` and not `/sds/request/anything`.
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
