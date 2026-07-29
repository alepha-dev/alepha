# Sigil (telemetry & feedback)

`@alepha/sigil` wires a Lore [Sigil](https://lore.alepha.dev) into an Alepha
app: cookieless pageview analytics (**beacon**), Web-Vitals **p75**, client &
server error capture (**blights**), and a floating **feedback** button that
opens the Lore petition page (**petition**) — all behind one module import.

> The package is **private** (vendor-only) and targets Alepha React apps. It
> replaces the legacy `<script src=".../embed.js">` snippet.

## How it works

The sigil **UUID is a server-only secret** — it never reaches the browser.
The module ships server code into your app that exposes a same-origin proxy
(`/api/sigil/*`); the browser posts telemetry to that proxy, and your server
forwards it to Lore over a server-to-server call authenticated solely by the
secret UUID. No `ingestKey`, no CORS, no `Origin`/UA gates.

```
browser ──(same-origin)──▶ /api/sigil/ingest ──(server→server, secret UUID)──▶ lore.alepha.dev
```

Telemetry is **mutualized**: pageviews, client errors, and vitals are batched
into a single ingest call (flushed on a timer + `pagehide`).

**Petitions** are first-party: the feedback button does a synchronous
`window.open("/sigil/request")`; that same-origin proxy resolves the
sigil → campaign id server-side (via `GET /sigils/:id/campaign`) and
302-redirects to the Lore petition page `{loreOrigin}/c/:campaignId/request`,
which requires login. The sigil id never reaches the browser, and petitions
have no DB relation to the sigil.

## Setup

One step, plus env.

**1. Import the module** in your web module:

```ts check
import { $module } from "alepha";
import { AlephaSigil } from "@alepha/sigil";

export const WebModule = $module({
  name: "myapp.web",
  imports: [AlephaSigil],
});
```

**2. Set the env** (server-only):

| Var | Required | Notes |
|-----|----------|-------|
| `SIGIL_ID` | to enable | The sigil UUID. A **server-only secret** — never prefix with `VITE_`. |
| `LORE_URL` | no | Override the Lore origin (default `https://lore.alepha.dev`). |
| `SIGIL_FEATURES` | no | Comma-separated enabled features (`petition,blights,beacon,vitals`). Absent = all enabled; acts purely as a filter — the app-side kill switch for individual capabilities. |

## Activation

Sigil is active **only when `alepha.isProduction()` and `SIGIL_ID` is set**.
In development it is silently inert. In production without `SIGIL_ID` it logs a
gentle warning and stays disabled (no fail-fast). The floating feedback button
auto-mounts via the framework's `RootComponentsProvider` slot — you don't place
any JSX, and there is no stylesheet to import (the button is inline-styled). It
renders only when the `petition` feature is enabled, and skips any path matching
the configured `excludedPaths` globs (re-evaluated on SPA navigation).

## What each capability needs

The **telemetry** capabilities (`beacon` / `blights` / `vitals`) are gated on
both sides: the app filters buckets whose feature is off before forwarding
(views→beacon, errors→blights, vitals→vitals — driven by `SIGIL_FEATURES`), and
Lore additionally gates by the campaign's feature flags and the sigil's `kinds`.
The **petition** button just opens the campaign's first-party request page,
which enforces login and the campaign's `petitions` feature itself.

## Privacy

No cookies, no client-supplied identity. Country + a daily-rotating,
non-reversible visitor hash are derived **server-side** (in your app, from its
own edge) and forwarded — Lore never sees a raw IP. Error stacks are truncated
and query strings stripped.
