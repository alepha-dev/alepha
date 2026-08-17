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

Then one server-side variable:

| Variable | Required | |
|---|---|---|
| `SIGIL_KEY` | **yes** | the sigil token the sink minted for this app — **secret, server-only** |
| `SIGIL_CONFIG` | **yes** | JSON: what this app reports, and where |
| `SIGIL_SALT` | no | overrides the secret salting the daily visitor hash. Falls back to `APP_SECRET` |

```
SIGIL_CONFIG={"project":"alepha","vitals":false}
```

| Field | Default | |
|---|---|---|
| `project` | — | **required.** The sink-side project this reports into |
| `analytics` | `true` | page views |
| `blights` | `true` | client and server errors |
| `vitals` | `true` | web-vitals samples |
| `feedback` | `true` | whether there is a feedback link at all |
| `feedbackButton` | `"bottom-right"` | `"hidden"`, `"bottom-left"` or `"bottom-right"` |
| `feedbackButtonExcludedPaths` | `[]` | path globs the button stays off — `*` within a segment, `**` across them |
| `sink` | `https://lore.alepha.dev` | origin of the sink; set it to self-host |

`sink` defaults to the public Lore instance the way `npm` defaults to
`registry.npmjs.org` — a commons that is there if you want it and one field
away if you do not. The default is inert on its own: nothing is sent without a
key, so an app that sets neither variable still captures locally and hands
aggregated errors to its own logger, phoning home to nothing. That is the
headless case, for an app that must not.

`feedback` and `feedbackButton` are separate on purpose: `feedback: false` means
there is no URL at all, while `feedback: true` with the button `hidden` gives
you the URL through `useFeedbackUrl()` to render wherever you like.

The resolved sink and where it came from are logged at boot, so a default is
never a surprise.

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

## Changing what it collects, without a rebuild

`SIGIL_CONFIG` is a variable, so on any platform with a dashboard you edit it
and the next request reads the new value. No CI, no rebuild.

It used to be fetched from the sink instead, and that failed in two opposite
ways. On a serverless runtime the isolate is discarded between requests, so the
cached answer was gone on nearly every one and fetched again — awaited in front
of the first byte of every cold page. On a prerendered app the same code ran
during the *build*, so the answer was baked into the HTML and could not change
until the next deploy: a kill-switch that needs a redeploy, which is the thing
the fetch existed to avoid.

**A page can still outlive its config** — a prerendered file, a cached
response, a restored document. The config sent to the browser carries the time
it was resolved, and a page whose stamp has aged asks for the current one on its
first ingest call, which is a call it was making anyway. Until that returns it
acts on what it was served with, so at most one envelope goes out under an old
config, and the server drops what it should not have accepted.

The sink decides separately what it *keeps*. What an app sends is its own
business; a sigil whose kinds withhold vitals discards them on arrival however
enthusiastic the sender.

## Errors are grouped before they leave

Errors are aggregated by fingerprint in the process, with stack frames
normalized so that bundle hashes and `:line:column` do not split one fault into
a fresh group on every deploy. What reaches the sink is a count per fingerprint,
not one payload per occurrence.

This is what keeps storage bound by how many distinct faults exist rather than
by how much traffic you have.

## Nothing is mounted for you

The module puts nothing in your React tree on its own. What it ships is one
optional component and one hook, both at `@alepha/sigil/react`:

```tsx
import { SigilRoot, usePetitionUrl } from "@alepha/sigil/react";

// Batteries included: a floating feedback button, rendered only when the sink
// hands out a petition URL and the current path is not excluded.
<SigilRoot />;

// Or render your own link, wherever it belongs.
const petition = usePetitionUrl();
return petition ? <a href={petition}>Report a problem</a> : null;
```

`@alepha/sigil/react` is a subpath of its own rather than part of the main
entry: importing the module should not drag React into an app that has none,
and a server-rendered host has to be able to resolve the component on the
server pass too.

A reporting package that injects DOM *without being asked* is one you then have
to style, translate and keep out of your own layout — for one button. Opting in
costs one line and gives you the placement.
