# Sigil (telemetry & feedback)

`@alepha/sigil` wires a Lore [Sigil](https://lore.alepha.dev) into an Alepha
app: cookieless pageview analytics (**beacon**), Web-Vitals **p75**, client &
server error capture (**blights**), and an in-app annotated-screenshot
**feedback** dialog (**petition**) — all behind one module import.

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
into a single ingest call (flushed on a timer + `pagehide`). The feedback
petition is a separate multipart call.

## Setup

Two steps, plus env.

**1. Import the module** in your web module:

```ts
import { $module } from "alepha";
import { AlephaSigil } from "@alepha/sigil";

export const WebModule = $module({
  name: "myapp.web",
  imports: [AlephaSigil],
});
```

**2. Import the styles** in your root CSS:

```css
@import "@alepha/sigil/styles";
```

**3. Set the env** (server-only):

| Var | Required | Notes |
|-----|----------|-------|
| `SIGIL_ID` | to enable | The sigil UUID. A **server-only secret** — never prefix with `VITE_`. |
| `LORE_URL` | no | Override the Lore origin (default `https://lore.alepha.dev`). |

## Activation

Sigil is active **only when `alepha.isProduction()` and `SIGIL_ID` is set**.
In development it is silently inert. In production without `SIGIL_ID` it logs a
gentle warning and stays disabled (no fail-fast). The floating feedback button
auto-mounts on every page via the framework's `RootComponentsProvider` slot —
you don't place any JSX.

## What each capability needs

Each capability is gated on the Lore side by the campaign's feature flags **and**
the sigil's `kinds` (`beacon` / `blights` / `vitals` / `petition`), configured by
the campaign owner in Lore. The module sends everything it can; Lore ignores
capabilities a given sigil hasn't enabled.

## Privacy

No cookies, no client-supplied identity. Country + a daily-rotating,
non-reversible visitor hash are derived **server-side** (in your app, from its
own edge) and forwarded — Lore never sees a raw IP. Error stacks are truncated
and query strings stripped.
