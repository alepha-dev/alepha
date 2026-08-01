# Sigil (analytics, vitals & errors)

`@alepha/sigil` makes an Alepha app report what it is doing: page views,
Web Vitals, and client and server errors — to the **sink** the app names. A
sink is anything serving the two sigil endpoints; Lore is one.

```typescript
import { Alepha } from "alepha";
import { AlephaSigil } from "@alepha/sigil";

Alepha.create()
  .with(AlephaSigil)
  .with(App)
  .start();
```

Then two server-side variables:

| Variable | |
|---|---|
| `SIGIL_SINK` | origin of the sink, e.g. `https://lore.example.com` |
| `SIGIL_KEY` | the sigil token the sink minted for this app + environment — **secret, server-only** |

Both are optional. Without them the module still captures, and aggregated
errors go to the logger instead of over the network — the headless case, for an
app that must not phone home.

Active in production only.

## The browser never holds the key

The browser posts to `/api/sigil/ingest` on the app's **own origin**; the app
then forwards to the sink server-to-server.

```
browser ──(same-origin)──▶ /api/sigil/ingest ──(server→server, SIGIL_KEY)──▶ lore.example.com
```

So the key never reaches the page, there is no CORS to configure, and no
third-party origin appears in your app.

## Cookieless by construction

Visitor identity is a hash of the request, salted with a value that rotates
daily **and** with the app's own host. Nothing follows a person between sites,
and nothing follows them across days.

There is no cookie and no local storage, which is what keeps this outside the
scope of a consent banner.

## How much it collects is decided at runtime

Sampling rates, which categories are on, and which paths are excluded come from
the sink — fetched at runtime, cached for a minute — not from environment
variables.

That is deliberate. A kill-switch that needs a redeploy is a kill-switch nobody
reaches in time.

## Errors are grouped before they leave

Errors are aggregated by fingerprint in the process, with stack frames
normalized so that bundle hashes and `:line:column` do not split one fault into
a fresh group on every deploy. What reaches the sink is a count per fingerprint,
not one payload per occurrence.

This is what keeps storage bound by how many distinct faults exist rather than
by how much traffic you have.

## No UI

The module mounts nothing in your React tree. `usePetitionUrl()` returns a link
for a feedback page; render it wherever it belongs.

A reporting package that injects DOM is one you have to style, translate and
test as a UI — for one button.
