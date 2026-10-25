# TurnstileCaptchaProvider

## Import

```typescript
import { TurnstileCaptchaProvider } from "alepha/captcha";
```

## Overview

Cloudflare Turnstile captcha verification provider.

Validates captcha tokens against the Cloudflare Turnstile siteverify API.
Free, privacy-friendly, and supports invisible mode.

## Setup

1. Create a Turnstile widget at https://dash.cloudflare.com/?to=/:account/turnstile
2. Copy the **Site Key** (public, for the client) and **Secret Key** (private, for the server)
3. Set `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` in your environment (both required)

## Client-side integration

Add the Turnstile script and widget to your form:

```html
<script
  src="https://challenges.cloudflare.com/turnstile/v0/api.js"
  async
  defer
></script>
<form>
  <div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>
  <button type="submit">Submit</button>
</form>
```

The widget injects a hidden `cf-turnstile-response` input into the form.
Send this value as the `captchaToken` in your registration request.

For explicit rendering (React, SPA):

```ts
turnstile.render("#container", {
  sitekey: "YOUR_SITE_KEY",
  callback: (token) => setCaptchaToken(token),
});
```

## Server-side usage

Register the provider in your app:

```ts
import { CaptchaProvider } from "alepha/captcha";
import { TurnstileCaptchaProvider } from "alepha/captcha";

alepha.with({ provide: CaptchaProvider, use: TurnstileCaptchaProvider });
```

## Test keys (for development)

- Always passes: site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`
- Always blocks: site `2x00000000000000000000AB`, secret `2x0000000000000000000000000000000AB`
- Forces interactive: site `3x00000000000000000000FF`

## Environment Variables

- `TURNSTILE_SECRET_KEY`: The secret key from the Cloudflare Turnstile dashboard (required).
- `TURNSTILE_SITE_KEY`: The public site key, exposed to the client via `getSiteKey()` (required).
- `TURNSTILE_EXPECTED_HOSTNAME`: Refuse a token solved on any other host (optional).
- `TURNSTILE_EXPECTED_ACTION`: Refuse a token solved for any other widget action (optional).

## Pinning the hostname and the action

A token is bound to the site it was solved on and the `action` its widget
declared, and siteverify reports both back. Nothing checks them unless you
say what to expect, so by default a token farmed from one of your pages is
accepted on any other - the login widget's token works against the
registration endpoint, and a token solved on a site sharing your secret
works anywhere.

Both are opt-in because both are easy to get wrong: an app served from an
apex and a `www` host, or from preview deployments, has more than one valid
hostname, and a single mismatch refuses every registration.
